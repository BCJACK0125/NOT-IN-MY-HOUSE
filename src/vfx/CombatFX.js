import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3
} from 'three';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';

import { LAYER } from '../core/Layers.js';
import { BladeImpact } from './BladeImpact.js';

const _v = new Vector3();
const _w = new Vector3();
const _m = new Matrix4();

/**
 * How hard each kind of contact lands. One satisfying hit is several small
 * responses firing inside ~100 ms; what separates a jab from a kill is how big
 * each of them is, not which of them fire. The hit-stop itself stays on the
 * move's own settings (see Game#playerSwing).
 *
 *   sparks  master on the spark burst (count and size)
 *   light   peak of the impact light
 *   smear   radial smear + aberration on the frame
 *   kick    metres the lens is punched along the blow
 *   roll    radians of roll on that punch
 *   fov     degrees of zoom (negative = in)
 *   flash   additive full-frame flash
 */
const TIERS = {
  kick: { sparks: 0.5, light: 5, smear: 0.08, kick: 0.035, roll: 0.006, fov: 0, flash: 0 },
  slash: { sparks: 0.8, light: 9, smear: 0.22, kick: 0.05, roll: 0.012, fov: 0, flash: 0 },
  kill: { sparks: 1.1, light: 14, smear: 0.5, kick: 0.08, roll: 0.02, fov: -3, flash: 0.04 },
  finisher: { sparks: 1.6, light: 22, smear: 1, kick: 0.13, roll: 0.03, fov: -8, flash: 0.16 }
};
const RANK = { kick: 0, slash: 1, kill: 2, finisher: 3 };

/** The spark palette: hot steel and the fire on the blade, not the blades' blue. */
const SPARKS = {
  enabled: true,
  color: '#fff3dc',
  ringColor: '#ff7a2a',
  size: 0.42,
  life: 0.2,
  intensity: 1.5,
  spikes: 5,
  spikeLength: 1.2,
  sparks: 22,
  sparkColor: '#ffbf6e',
  sparkSpeed: 8.5,
  sparkSpread: 0.6,
  sparkLife: 0.42,
  sparkSize: 0.042,
  sparkStretch: 0.05,
  sparkDrag: 1.8,
  sparkGravity: -15
};

/**
 * Everything a blow says on screen besides the body and the blood.
 *
 * Each of these follows the same game-feel rules: exaggerate briefly, then
 * return to rest, and scale with how much the event matters.
 *  - **sparks** off the point of contact, thrown along the swing rather than
 *    out of it in a sphere, so a cut reads as having gone *through*;
 *  - an **impact light** that jumps to the contact, holding through the
 *    hit-stop because it decays on simulation time;
 *  - a **sword trail** following the real blade, curve-smoothed between frames
 *    so a fast swing is an arc and not a fan of straight lines;
 *  - **glints** on an enemy at the moment its swing commits: the cue to dodge;
 *  - **afterimages** left behind by a dash, bright on a perfect dodge;
 *  - the **screen** pulses (radial smear, flash, 見切's cold grade) and the
 *    lens's directional kick, gathered per frame so a sweep through three
 *    bodies kicks the camera once, as hard as the hardest of them.
 */
export class CombatFX {
  constructor(app) {
    this.app = app;
    this.group = new Group();
    this.group.name = 'CombatFX';
    app.scene.add(this.group);

    this.sparks = new BladeImpact(640);
    this.group.add(this.sparks.mesh);

    this.light = new PointLight('#ffb067', 0, 7, 2);
    this.light.castShadow = false;
    this.group.add(this.light);
    this._light = 0;

    this.trail = new SwordTrail();
    this.group.add(this.trail.mesh);

    // Phones run without bloom, and without it a katana is a two-pixel line
    // that vanishes behind the body. This stands in for the halo.
    this.bladeGlow = app.isTouch ? new BladeGlow() : null;
    if (this.bladeGlow) this.group.add(this.bladeGlow.mesh);

    this.glints = new Glints(6);
    this.group.add(this.glints.group);

    this.ghosts = new Afterimages(app.character, 5);
    this.group.add(this.ghosts.group);

    /** Player option: scales flashes and smears (the camera has its own). */
    this.intensity = 1;

    this._pending = null;
    this._smear = 0;
    this._flash = 0;
    this._flashColor = new Color(1, 0.86, 0.7);
    this._desat = 0;
    this._center = new Vector3();
    this._tipVel = new Vector3(0, 0, 1);
    this._ghostTimer = 0;
    this._ghostLeft = 0;
    this._ghostPerfect = false;
  }

  /* ---------------- events ---------------- */

  /**
   * A player's blow lands on `enemy`.
   * @param {'kick'|'slash'|'kill'|'finisher'} tier
   */
  hit(enemy, tier, x, z) {
    const t = TIERS[tier] ?? TIERS.slash;
    const pos = this.app.character.position;
    const e = enemy.position;
    // The contact: chest height, on the near side of the body.
    const dx = pos.x - e.x;
    const dz = pos.z - e.z;
    const l = Math.hypot(dx, dz) || 1;
    _v.set(e.x + (dx / l) * enemy.radius * 0.8, e.y + 1.15 * enemy.size, e.z + (dz / l) * enemy.radius * 0.8);
    // Which way the blow was going: the blade's own heading on a cut, the
    // line of the kick otherwise.
    if (tier !== 'kick' && this.trail.active && this._tipVel.lengthSq() > 1) _w.copy(this._tipVel).normalize();
    else _w.set(x, 0.15, z).normalize();
    this.sparks.burst(_v.x, _v.y, _v.z, _w.x, _w.y, _w.z, SPARKS, t.sparks);

    if (t.light >= this._light) {
      this._light = t.light;
      this.light.position.copy(_v);
    }
    const p = this._pending;
    if (!p || RANK[tier] > RANK[p.tier]) {
      this._pending = { tier, x: _w.x, y: _w.y, z: _w.z, at: _v.clone() };
    }
  }

  /** The player is hit, from `(x, z)` (unit, pointing from the enemy to the player). */
  hurt(x, z, damage) {
    const cam = this.app.cam;
    const k = Math.min(1, 0.5 + damage / 40);
    cam.kick(x, 0.1, z, 0.14 * k, (Math.random() < 0.5 ? -1 : 1) * 0.035 * k);
    this._smear = Math.max(this._smear, 0.3 * k * this.intensity);
    this._center.set(0.5, 0.5, 0);
    this._flashColor.setRGB(0.55, 0.02, 0.0);
    this._flash = Math.max(this._flash, 0.12 * k * this.intensity);
  }

  /** An enemy's swing commits. A heavy one (a slam) glints red. */
  glint(enemy, heavy) {
    const f = enemy.facing;
    _v.set(
      enemy.position.x + Math.sin(f) * 0.35 * enemy.size,
      enemy.position.y + 1.55 * enemy.size,
      enemy.position.z + Math.cos(f) * 0.35 * enemy.size
    );
    this.glints.spawn(_v, heavy ? 1.5 * enemy.size : 0.95 * enemy.size, heavy);
  }

  /** A dash leaves afterimages; a perfect one leaves more of them, brighter. */
  dodge(perfect = false) {
    this._ghostLeft = perfect ? 4 : 2;
    this._ghostTimer = 0;
    this._ghostPerfect = perfect;
    if (perfect) {
      this._flashColor.setRGB(0.35, 0.6, 1.0);
      this._flash = Math.max(this._flash, 0.1 * this.intensity);
      this._smear = Math.max(this._smear, 0.35 * this.intensity);
      this._center.set(0.5, 0.5, 0);
      this.ghosts.spawn(true);
    }
  }

  /**
   * Build the afterimage rigs and draw everything once, invisibly, while the
   * game is still loading: a shader compiled on the first dash of a fight is a
   * dropped frame on the one moment that has to be smooth.
   */
  prewarm() {
    if (!this.ghosts.ghosts && !this.ghosts._build()) return;
    for (const g of this.ghosts.ghosts) {
      g.root.visible = true;
      g.t = 0;
      g.life = 0.25;
      g.peak = 0;
      for (const m of g.mats) m.opacity = 0;
    }
    const it = this.glints.items[0];
    it.sprite.visible = true;
    it.sprite.material.opacity = 0;
    it.t = 0;
    it.life = 0.25;
    it.size = 0.001;
  }

  /** A big flash for a scripted moment (boss down, and so on). */
  flash(amount, r = 1, g = 0.9, b = 0.8) {
    this._flashColor.setRGB(r, g, b);
    this._flash = Math.max(this._flash, amount * this.intensity);
  }

  clear() {
    this.sparks.clear();
    this.trail.clear();
    this.glints.clear();
    this.ghosts.clear();
    this._light = 0;
    this._smear = 0;
    this._flash = 0;
    this._pending = null;
    this._ghostLeft = 0;
  }

  /* ---------------- frame ---------------- */

  /**
   * @param {number} dt simulation seconds (slowed by hit-stop and slow-mo)
   * @param {number} raw real seconds
   * @param {number} elapsed the simulation clock
   */
  update(dt, raw, elapsed) {
    const app = this.app;
    const game = app.game;
    this.sparks.sync(elapsed, SPARKS);

    // The light decays on the simulation clock: it holds through the freeze.
    this._light *= Math.exp(-dt * 20);
    if (this._light < 0.05) this._light = 0;
    // Intensity only, never `visible`: the light count is baked into every
    // shader, and toggling it recompiles the lot.
    this.light.intensity = this._light;

    // The blade.
    const swinging = this._swinging(game);
    this.trail.update(elapsed, swinging, app.equipment?.get('sword')?.model, app.character.position, dt);
    if (this.trail.tipVel) this._tipVel.copy(this.trail.tipVel);
    if (this.bladeGlow) {
      const sword = app.equipment?.get('sword');
      const lit = game.hasSword && sword?.mount.visible && app.character.root.visible && this.trail.haveBlade;
      this.bladeGlow.update(lit, this.trail.worldBase, this.trail.worldTip, raw);
    }

    // Gathered blows: the lens and the screen respond once, to the hardest.
    const p = this._pending;
    if (p) {
      this._pending = null;
      const t = TIERS[p.tier];
      const roll = (Math.random() < 0.5 ? -1 : 1) * t.roll;
      app.cam.kick(p.x, p.y * 0.3, p.z, t.kick, roll);
      if (t.fov) app.cam.fovKick = Math.min(app.cam.fovKick, t.fov * app.cam.shakeScale);
      if (t.smear * this.intensity > this._smear) {
        this._smear = t.smear * this.intensity;
        _v.copy(p.at).project(app.camera);
        this._center.set(Math.min(1, Math.max(0, (_v.x + 1) / 2)), Math.min(1, Math.max(0, (_v.y + 1) / 2)), 0);
      }
      if (t.flash) {
        this._flashColor.setRGB(1, 0.86, 0.7);
        this._flash = Math.max(this._flash, t.flash * this.intensity);
      }
    }

    this.glints.update(raw);

    // Afterimages: one dropped every few hundredths while the dash lasts.
    if (this._ghostLeft > 0 && app.controller.dodging) {
      this._ghostTimer -= raw;
      if (this._ghostTimer <= 0) {
        this._ghostTimer = 0.045;
        this._ghostLeft--;
        this.ghosts.spawn(this._ghostPerfect);
      }
    }
    this.ghosts.update(raw);

    // Screen pulses run on real time: the frame keeps rendering through a freeze.
    this._smear = Math.max(0, this._smear - raw * 4.5);
    this._flash = Math.max(0, this._flash - raw * 1.6);
    const want = game._slowmo > 0 ? 1 : 0;
    this._desat += (want - this._desat) * Math.min(1, raw * (want ? 14 : 4));
    const u = app.post.gradePass.uniforms;
    u.uImpact.value = this._smear;
    u.uImpactCenter.value.set(this._center.x, this._center.y);
    u.uFlash.value = this._flash;
    u.uFlashColor.value.copy(this._flashColor);
    u.uDesat.value = this._desat * Math.max(0.4, this.intensity);
  }

  _swinging(game) {
    if (!game.hasSword || !game.playing) return false;
    for (const move of this.app.character.attacks ?? []) {
      if (move.locked && move.configKey !== 'kick') return true;
    }
    return false;
  }
}

/* ======================================================================= */

const TRAIL_MAX = 40;
const TRAIL_SUB = 4;
const TRAIL_LIFE = 0.2;

/**
 * A ribbon between the blade's guard and its tip, sampled once a frame while
 * a cut is in the air.
 *
 * The samples are frames apart and a swing covers most of a half-turn in
 * three of them, so the ribbon is drawn through a Catmull–Rom curve over the
 * samples rather than straight between them. Ages run on the simulation
 * clock, so a hit-stop freezes the arc on screen with the frame it hit on.
 */
class SwordTrail {
  constructor() {
    this.samples = [];
    this.active = false;
    this.tipVel = null;
    this._strip = 0;
    this._was = false;
    this._base = null;
    this._tip = null;
    this._lastTip = new Vector3();
    this._lastRoot = new Vector3();
    this._haveLast = false;
    /** Where the steel is this frame, in world space (guard → point). */
    this.worldBase = new Vector3();
    this.worldTip = new Vector3();
    this.haveBlade = false;

    const verts = TRAIL_MAX * TRAIL_SUB * 2;
    this.positions = new Float32Array(verts * 3);
    this.fades = new Float32Array(verts);
    this.sides = new Float32Array(verts);
    this.index = new Uint16Array(TRAIL_MAX * TRAIL_SUB * 6);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aFade', new BufferAttribute(this.fades, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aSide', new BufferAttribute(this.sides, 1).setUsage(DynamicDrawUsage));
    g.setIndex(new BufferAttribute(this.index, 1).setUsage(DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geometry = g;

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uHot: { value: new Color('#ffe6c0') },
        uMid: { value: new Color('#ff5e14') },
        uCool: { value: new Color('#4a0900') },
        uIntensity: { value: 1.7 }
      },
      vertexShader: /* glsl */ `
        attribute float aFade;
        attribute float aSide;
        varying float vFade;
        varying float vSide;
        void main() {
          vFade = aFade;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHot;
        uniform vec3 uMid;
        uniform vec3 uCool;
        uniform float uIntensity;
        varying float vFade;
        varying float vSide;
        void main() {
          float f = clamp(vFade, 0.0, 1.0);
          // A thin hot edge where the point passed, a thin warm veil behind it.
          float edge = smoothstep(0.8, 1.0, vSide);
          float body = smoothstep(0.0, 1.0, vSide);
          vec3 c = mix(uCool, uMid, f);
          c = mix(c, uHot, edge * f * f);
          float a = body * body * pow(f, 1.8) * (0.12 + 0.88 * edge);
          gl_FragColor = vec4(c * uIntensity, a);
        }
      `
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'SwordTrail';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.layers.set(LAYER.VFX);
    this.mesh.raycast = () => {};
  }

  clear() {
    this.samples.length = 0;
    this.geometry.setDrawRange(0, 0);
    this._haveLast = false;
  }

  /** Where the steel is, in the sword model's own space: guard and tip, found once. */
  _measure(model) {
    model.updateWorldMatrix(true, true);
    const inv = _m.copy(model.matrixWorld).invert();
    const pts = [];
    const skip = (o) => o.name === 'FireEmitterBox' || o.userData?.isFireVolume;
    const visit = (o) => {
      if (skip(o)) return;
      for (const c of o.children) visit(c);
      const p = o.geometry?.attributes?.position;
      if (!p || !o.isMesh) return;
      const step = Math.max(1, Math.floor(p.count / 400));
      for (let i = 0; i < p.count; i += step) {
        pts.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
      }
    };
    visit(model);
    if (pts.length < 8) return false;
    // The long axis (power iteration on the covariance), then its two ends.
    const mean = new Vector3();
    for (const p of pts) mean.add(p);
    mean.divideScalar(pts.length);
    const axis = new Vector3(1, 1, 1).normalize();
    const d = new Vector3();
    for (let it = 0; it < 24; it++) {
      const n = new Vector3();
      for (const p of pts) {
        d.subVectors(p, mean);
        n.addScaledVector(d, d.dot(axis));
      }
      axis.copy(n.normalize());
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      const t = d.subVectors(p, mean).dot(axis);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    // The point end is the one further from the hand (the model's origin).
    const a = mean.clone().addScaledVector(axis, lo);
    const b = mean.clone().addScaledVector(axis, hi);
    const [pommel, point] = a.length() < b.length() ? [a, b] : [b, a];
    this._base = pommel.clone().lerp(point, 0.32);
    this._tip = pommel.clone().lerp(point, 0.98);
    return true;
  }

  update(elapsed, emitting, model, root, dt) {
    const s = this.samples;
    while (s.length && elapsed - s[0].time > TRAIL_LIFE) s.shift();
    this.tipVel = null;

    if (model && model.visible !== false && (this._base || this._measure(model))) {
      model.updateWorldMatrix(true, false);
      const base = this._base.clone().applyMatrix4(model.matrixWorld);
      const tip = this._tip.clone().applyMatrix4(model.matrixWorld);
      this.worldBase.copy(base);
      this.worldTip.copy(tip);
      this.haveBlade = true;
      if (this._haveLast && dt > 1e-5) {
        // The blade's own speed, with the body's travel taken out of it: a warp
        // carries the whole sword along and is not a swing.
        const vel = tip.clone().sub(this._lastTip).sub(_w.copy(root).sub(this._lastRoot)).divideScalar(dt);
        this.tipVel = vel;
        emitting = emitting && vel.length() > 4.5;
      } else emitting = false;
      this._lastTip.copy(tip);
      this._lastRoot.copy(root);
      this._haveLast = true;
      if (emitting) {
        if (!this._was) this._strip++;
        // A long freeze would pile identical samples up; one per tiny step is enough.
        const last = s[s.length - 1];
        if (!last || last.strip !== this._strip || last.tip.distanceToSquared(tip) > 0.0004) {
          s.push({ base, tip, time: elapsed, strip: this._strip });
          if (s.length > TRAIL_MAX) s.shift();
        }
      }
    } else {
      emitting = false;
    }
    this._was = emitting;
    this.active = emitting;
    this._build(elapsed);
  }

  _build(elapsed) {
    const s = this.samples;
    const pos = this.positions;
    const fades = this.fades;
    const sides = this.sides;
    const index = this.index;
    let v = 0;
    let n = 0;
    let i = 0;
    while (i < s.length) {
      // One strip: a run of samples from the same swing.
      let j = i;
      while (j + 1 < s.length && s[j + 1].strip === s[i].strip) j++;
      if (j > i) {
        const first = v;
        for (let k = i; k <= j; k++) {
          const p0 = s[Math.max(i, k - 1)];
          const p1 = s[k];
          const p2 = s[Math.min(j, k + 1)];
          const p3 = s[Math.min(j, k + 2)];
          const subs = k === j ? 1 : TRAIL_SUB;
          for (let q = 0; q < subs; q++) {
            const t = q / TRAIL_SUB;
            const time = p1.time + (p2.time - p1.time) * t;
            const fade = 1 - (elapsed - time) / TRAIL_LIFE;
            catmull(p0.base, p1.base, p2.base, p3.base, t, _v);
            pos[v * 3] = _v.x; pos[v * 3 + 1] = _v.y; pos[v * 3 + 2] = _v.z;
            fades[v] = fade; sides[v] = 0;
            v++;
            catmull(p0.tip, p1.tip, p2.tip, p3.tip, t, _v);
            pos[v * 3] = _v.x; pos[v * 3 + 1] = _v.y; pos[v * 3 + 2] = _v.z;
            fades[v] = fade; sides[v] = 1;
            v++;
          }
        }
        for (let a = first; a + 3 < v; a += 2) {
          index[n++] = a; index[n++] = a + 1; index[n++] = a + 2;
          index[n++] = a + 1; index[n++] = a + 3; index[n++] = a + 2;
        }
      }
      i = j + 1;
    }
    const g = this.geometry;
    g.setDrawRange(0, n);
    if (n) {
      g.attributes.position.needsUpdate = true;
      g.attributes.aFade.needsUpdate = true;
      g.attributes.aSide.needsUpdate = true;
      g.index.needsUpdate = true;
    }
  }
}

/**
 * A soft glow laid along the blade, facing the camera: the halo a bloom pass
 * would have drawn, for the frames that have none. It depth-tests, so the body
 * hides the part behind it and the rest spills past the silhouette — which is
 * exactly how the real halo gives away a sword held on the far side.
 */
class BladeGlow {
  constructor() {
    const g = new BufferGeometry();
    // (t along the blade, side): a little past either end, for soft caps.
    const c = new Float32Array([-0.1, -1, 0, 1.1, -1, 0, 1.1, 1, 0, -0.1, 1, 0]);
    g.setAttribute('position', new BufferAttribute(c, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uBase: { value: new Vector3() },
        uTip: { value: new Vector3() },
        uWidth: { value: 0.11 },
        uColor: { value: new Color('#ff6a1c') },
        uIntensity: { value: 0 }
      },
      vertexShader: /* glsl */ `
        uniform vec3 uBase;
        uniform vec3 uTip;
        uniform float uWidth;
        varying vec2 vC;
        void main() {
          vec4 a = viewMatrix * vec4(uBase, 1.0);
          vec4 b = viewMatrix * vec4(uTip, 1.0);
          vec4 v = mix(a, b, position.x);
          vec2 d = b.xy - a.xy;
          float l = length(d);
          vec2 n = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(1.0, 0.0);
          v.xy += n * position.y * uWidth;
          // Pulled a touch toward the lens so the steel itself never hides it.
          v.xyz *= 0.985;
          vC = position.xy;
          gl_Position = projectionMatrix * v;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec2 vC;
        void main() {
          float across = 1.0 - abs(vC.y);
          float along = smoothstep(-0.1, 0.12, vC.x) * (1.0 - smoothstep(0.88, 1.1, vC.x));
          float halo = across * across * along;
          float core = pow(across, 10.0) * along;
          vec3 c = uColor * halo * 0.75 + vec3(1.0, 0.82, 0.55) * core * 0.9;
          gl_FragColor = vec4(c * uIntensity, 1.0);
        }
      `
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'BladeGlow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.layers.set(LAYER.VFX);
    this.mesh.raycast = () => {};
    this._k = 0;
    this._t = 0;
  }

  update(on, base, tip, raw) {
    this._t += raw;
    this._k += ((on ? 1 : 0) - this._k) * Math.min(1, raw * 6);
    const u = this.material.uniforms;
    u.uBase.value.copy(base);
    u.uTip.value.copy(tip);
    // A living flicker, not a lamp.
    const f = 0.88 + 0.08 * Math.sin(this._t * 13.1) + 0.05 * Math.sin(this._t * 29.7 + 1.3);
    u.uIntensity.value = this._k * f;
    this.mesh.visible = this._k > 0.01;
  }
}

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  for (const c of ['x', 'y', 'z']) {
    out[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return out;
}

/* ======================================================================= */

/** A four-point star on a canvas, shared by every glint. */
function starTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const m = size / 2;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  glow.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  // Two long rays on the cross, two short ones on the diagonals.
  for (const [len, thick, turn] of [[m * 0.95, 3.2, 0], [m * 0.95, 3.2, Math.PI / 2], [m * 0.42, 2, Math.PI / 4], [m * 0.42, 2, -Math.PI / 4]]) {
    g.save();
    g.translate(m, m);
    g.rotate(turn);
    const ray = g.createLinearGradient(-len, 0, len, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,1)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.fillRect(-len, -thick / 2, len * 2, thick);
    g.restore();
  }
  return new CanvasTexture(c);
}

/**
 * The tell. A star that flares on an enemy the instant its swing commits:
 * past this point the blow is coming, and a dash now is a perfect one.
 */
class Glints {
  constructor(count) {
    this.group = new Group();
    this.group.name = 'Glints';
    const map = starTexture();
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new SpriteMaterial({ map, color: new Color(1, 1, 1), blending: AdditiveBlending, transparent: true, depthWrite: false });
      const s = new Sprite(mat);
      s.visible = false;
      s.renderOrder = 13;
      s.layers.set(LAYER.VFX);
      s.raycast = () => {};
      this.group.add(s);
      this.items.push({ sprite: s, t: 1, life: 0.36, size: 1 });
    }
    this._next = 0;
  }

  spawn(at, size, heavy) {
    const it = this.items[this._next];
    this._next = (this._next + 1) % this.items.length;
    it.sprite.position.copy(at);
    it.t = 0;
    it.size = size;
    it.life = heavy ? 0.5 : 0.36;
    // Over 1 so the bloom picks it up: warm white, or red for a slam.
    if (heavy) it.sprite.material.color.setRGB(6, 0.9, 0.35);
    else it.sprite.material.color.setRGB(4.2, 3.6, 2.6);
    it.sprite.visible = true;
  }

  update(raw) {
    for (const it of this.items) {
      if (!it.sprite.visible) continue;
      it.t += raw;
      const k = it.t / it.life;
      if (k >= 1) { it.sprite.visible = false; continue; }
      // Snap open, then close slower, turning a little as it goes.
      const open = Math.min(1, it.t / 0.05);
      const s = it.size * open * (1 - k * k) * 1.1;
      it.sprite.scale.set(s, s, 1);
      it.sprite.material.rotation = k * 0.9;
      it.sprite.material.opacity = 1 - k * k;
    }
  }

  clear() {
    for (const it of this.items) it.sprite.visible = false;
  }
}

/* ======================================================================= */

/**
 * Afterimages: frozen, glowing copies of the body dropped along a dash.
 *
 * Each ghost is a full clone of the rig with its own skeleton (built once,
 * the first time it is needed), posed by copying every joint's local
 * transform off the live body at the instant it is dropped. Two materials per
 * ghost, as in ShadowCharacter: one for skinned meshes, one for the rest.
 */
class Afterimages {
  constructor(character, count) {
    this.character = character;
    this.count = count;
    this.group = new Group();
    this.group.name = 'Afterimages';
    this.ghosts = null;
    this._next = 0;
  }

  _build() {
    const model = this.character.model;
    if (!model) return false;
    this.ghosts = [];
    for (let i = 0; i < this.count; i++) {
      const root = cloneRigged(model);
      const skinned = new MeshBasicMaterial({ color: '#5fb6ff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      const flat = skinned.clone();
      const pairs = [];
      const cut = [];
      walk(model, root, (src, dst) => {
        if (src === model) return;
        if (dst.name === 'FireEmitterBox' || dst.userData?.isFireVolume) { cut.push(dst); return; }
        pairs.push([src, dst]);
      });
      root.traverse((node) => {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        node.material = node.isSkinnedMesh ? skinned : flat;
        node.castShadow = false;
        node.receiveShadow = false;
        node.frustumCulled = false;
        node.layers.set(LAYER.VFX);
        node.raycast = () => {};
      });
      for (const node of cut) node.parent?.remove(node);
      const dropped = new Set();
      for (const node of cut) node.traverse((c) => dropped.add(c));
      const live = pairs.filter(([, d]) => !dropped.has(d));
      root.matrixAutoUpdate = false;
      root.visible = false;
      this.group.add(root);
      this.ghosts.push({ root, pairs: live, mats: [skinned, flat], t: 1, life: 0.3, peak: 0.5 });
    }
    return true;
  }

  spawn(perfect) {
    if (!this.ghosts && !this._build()) return;
    const g = this.ghosts[this._next];
    this._next = (this._next + 1) % this.ghosts.length;
    const model = this.character.model;
    model.updateWorldMatrix(true, false);
    g.root.matrix.copy(model.matrixWorld);
    g.root.matrixWorldNeedsUpdate = true;
    for (const [src, dst] of g.pairs) {
      dst.position.copy(src.position);
      dst.quaternion.copy(src.quaternion);
      dst.scale.copy(src.scale);
      dst.visible = src.visible;
    }
    g.root.visible = true;
    g.t = 0;
    g.life = perfect ? 0.55 : 0.28;
    g.peak = perfect ? 0.85 : 0.38;
    const color = perfect ? '#9fdcff' : '#4f9dff';
    for (const m of g.mats) m.color.set(color);
  }

  update(raw) {
    if (!this.ghosts) return;
    for (const g of this.ghosts) {
      if (!g.root.visible) continue;
      g.t += raw;
      const k = g.t / g.life;
      if (k >= 1) { g.root.visible = false; continue; }
      const o = g.peak * (1 - k) * (1 - k);
      for (const m of g.mats) m.opacity = o;
    }
  }

  clear() {
    if (!this.ghosts) return;
    for (const g of this.ghosts) g.root.visible = false;
  }
}

function walk(a, b, fn) {
  fn(a, b);
  for (let i = 0; i < a.children.length; i++) {
    if (b.children[i]) walk(a.children[i], b.children[i], fn);
  }
}
