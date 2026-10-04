import { Box3, Frustum, Group, MathUtils, Matrix4, Sphere, Vector3 } from 'three';

import { settings } from '../config/settings.js';
import { ENEMY_TYPES } from '../config/enemyTypes.js';
import { disposeObject } from '../utils/dispose.js';
import { indexBones, retargetClip } from '../animation/retarget.js';
import { Enemy } from './Enemy.js';
import { K, floorY, HOME_FLOOR } from '../world/World.js';

/** The body, with its idle baked in — one file, cloned per enemy. */
const ENEMY_URL = './models/enemyidle.fbx';

/** Clips lifted off the player's own motion files onto the enemy rig. */
const ENEMY_CLIPS = ['walk', 'run', 'crouch', 'kick', 'slashHit', 'crouchSlash', 'jumpHit'];

const _v = new Vector3();
const _frustum = new Frustum();
const _m = new Matrix4();
const _sphere = new Sphere();

/** Which part of the building a point is in: 'home' · 'stairs' · 'outside'. */
export function zoneOf(x, y, z) {
  const u = x / K;
  const w = z / K;
  const column = u > 6.5 && u < 11.95 && w > 10.6 && w < 13.5;
  const y1 = floorY(1);
  const y8 = floorY(HOME_FLOOR);
  if (column && u >= 8.3 && y > y1 + 0.25 && y < y8 + 0.6) return 'stairs';
  if (column && u >= 8.3 && y >= y8 + 0.6) return 'home';
  if (column && y > y1 + 1.0 && y < y8 - 1.0) return 'stairs';
  if (y > y8 - 1.0) return 'home';
  return 'outside';
}

/**
 * The population, and the rules of engagement.
 *
 *  - Spawning is explicit (the story places every body) — no ring refill.
 *  - At most `maxAttackers` swing at once (the boss counts as all of them);
 *    the rest circle. That is the whole difference between a fair crowd and a
 *    blender.
 *  - Steering: on a storey, roll down the zone's distance field toward the
 *    player (or toward the door into the player's zone); on the stairs, walk
 *    the stair line toward the player's arc length.
 */
export class EnemyManager {
  constructor({ terrain = null, effects = null, world = null, level = null } = {}) {
    this.terrain = terrain;
    this.effects = effects;
    this.world = world;
    this.level = level;
    this.group = new Group();
    this.group.name = 'Enemies';
    /** @type {Enemy[]} */
    this.enemies = [];
    this.source = null;
    this.clip = null;
    this.clips = new Map();
    this._localHeight = 1;
    this._forwardYaw = 0;
    this._base = null;
    this.kills = 0;
    this._uid = 0;
    this.maxAttackers = 2;
    /** Written by the game every frame. */
    this.player = { x: 0, y: 0, z: 0, zone: 'home', alive: true, invisible: false };
    this.hooks = {};
    this._fieldTimer = 0;
    this.fields = null;
  }

  /* ------------------------------------------------------------------ */

  async load(assets, motionSources) {
    const fbx = await assets.loadFBX(ENEMY_URL);
    await assets.settled();
    this.clip = fbx.animations?.[0] ?? null;
    fbx.scale.setScalar(1);
    fbx.updateMatrixWorld(true);
    const box = new Box3().setFromObject(fbx);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    this._localHeight = Math.max(1e-3, size.y);
    this._base = { cx: center.x, cz: center.z, minY: box.min.y };
    this.source = fbx;
    this._measureFacing(fbx);
    const bones = indexBones(fbx);
    for (const name of ENEMY_CLIPS) {
      const src = motionSources?.get(name);
      const clip = retargetClip(src?.animations?.[0], bones, name);
      if (clip) this.clips.set(name, clip);
    }
    return this;
  }

  _measureFacing(root) {
    let foot = null;
    let toe = null;
    root.traverse((node) => {
      if (!node.isBone) return;
      const name = node.name.split(':').pop().replace(/^mixamorig/i, '');
      if (name === 'LeftFoot') foot = node;
      else if (name === 'LeftToeBase') toe = node;
    });
    if (!foot || !toe) return;
    const heel = foot.getWorldPosition(new Vector3());
    const tip = toe.getWorldPosition(_v).sub(heel).setY(0);
    if (tip.lengthSq() > 1e-6) this._forwardYaw = Math.atan2(tip.x, tip.z);
  }

  /** Distance fields per zone: toward the player, and toward each doorway. */
  buildFields() {
    const L = this.level;
    const y8 = floorY(HOME_FLOOR);
    const y1 = floorY(1);
    this.portals = {
      // home → stairs: the top of the first flight down
      homeToStairs: { x: 8.25 * K, y: y8, z: 11.35 * K },
      // outside → stairs: the bottom of the last flight
      outsideToStairs: { x: 8.0 * K, y: y1, z: 12.7 * K }
    };
    this.fields = {
      home: L.navHome,
      homePortal: cloneGrid(L.navHome),
      outside: L.navOutside,
      outsidePortal: cloneGrid(L.navOutside)
    };
    this.fields.homePortal.setGoal(this.portals.homeToStairs.x, this.portals.homeToStairs.z);
    this.fields.outsidePortal.setGoal(this.portals.outsideToStairs.x, this.portals.outsideToStairs.z);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Stand one up.
   * @param {keyof ENEMY_TYPES} kind
   * @param {{x:number,y?:number,z:number,yaw?:number,crouch?:boolean,awake?:boolean,spawn?:'rise'|'climb',from?:Vector3}} at
   */
  spawn(kind, at) {
    if (!this.source) return null;
    const type = ENEMY_TYPES[kind] ?? ENEMY_TYPES.shade;
    const scale = (settings.enemies.height * type.scale) / this._localHeight;
    const offset = new Vector3(-this._base.cx * scale, -this._base.minY * scale, -this._base.cz * scale);
    const enemy = new Enemy({
      source: this.source,
      clip: this.clip,
      scale,
      offset,
      localHeight: this._localHeight,
      forwardYaw: this._forwardYaw,
      terrain: this.terrain,
      effects: this.effects,
      clips: this.clips,
      type,
      manager: this
    });
    enemy.kind = kind;
    enemy.uid = ++this._uid;
    const yaw = at.yaw ?? Math.atan2(this.player.x - at.x, this.player.z - at.z);
    enemy.place(at.x, at.z, yaw, (at.y ?? this.player.y) + 0.4);
    enemy.zone = zoneOf(at.x, enemy.position.y, at.z);
    enemy.crouching = !!at.crouch;
    if (at.awake) enemy.wake();
    if (at.spawn) enemy.spawnEffect(at.spawn, at.from ?? null);
    enemy.tag = at.tag ?? null;
    this.group.add(enemy.root);
    this.enemies.push(enemy);
    return enemy;
  }

  get alive() {
    return this.enemies.filter((e) => e.alive);
  }

  countAlive(tag = null) {
    let n = 0;
    for (const e of this.enemies) if (e.alive && (tag === null || e.tag === tag)) n++;
    return n;
  }

  update(dt) {
    if (!this.source) return;
    this._fieldTimer -= dt;
    if (this.fields && this._fieldTimer <= 0) {
      this._fieldTimer = 0.2;
      const P = this.player;
      if (P.zone === 'home') this.fields.home.setGoal(P.x, P.z);
      else if (P.zone === 'outside') this.fields.outside.setGoal(P.x, P.z);
    }
    const cam = this.camera;
    if (cam) {
      cam.updateMatrixWorld();
      _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_m);
    }
    const P = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy.alive) enemy.zone = zoneOf(enemy.position.x, enemy.position.y, enemy.position.z);
      // Cull what the lens cannot see, and animate far, idle bodies at a
      // fraction of the rate — a skinned crowd is the costliest thing on screen.
      const d = Math.hypot(enemy.position.x - P.x, enemy.position.y - P.y, enemy.position.z - P.z);
      if (cam) {
        _sphere.center.copy(enemy.position);
        _sphere.center.y += 1 * enemy.size;
        _sphere.radius = 1.6 * enemy.size + (enemy.alive ? 0 : 1.5);
        enemy.root.visible = d < 120 && _frustum.intersectsSphere(_sphere);
      }
      enemy.lod = !enemy.root.visible || (d > 28 && enemy.ai === 'dormant') ? 4 : 1;
      const shadow = d < 22;
      if (enemy._shadow !== shadow) {
        enemy._shadow = shadow;
        if (enemy.alive) enemy.root.traverse((n) => { if (n.isMesh || n.isSkinnedMesh) n.castShadow = shadow; });
      }
      enemy.update(dt);
      if (!enemy.finished) continue;
      enemy.dispose();
      this.enemies.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ */
  /* rules of engagement                                                 */
  /* ------------------------------------------------------------------ */

  canNotice(enemy, dist, dy) {
    const P = this.player;
    if (enemy.zone !== P.zone) return false;
    if (Math.abs(dy) > 2.2) return false;
    if (dist < 4.5) return true;
    if (dist > 16) return false;
    const pos = enemy.position;
    return this.world.sight(pos.x, pos.y + 1.5, pos.z, P.x, P.y + 1.4, P.z);
  }

  takeToken(enemy) {
    if (enemy.token) return true;
    let busy = 0;
    for (const e of this.enemies) if (e.alive && e.token) busy += e.type.boss ? 99 : 1;
    if (enemy.type.boss) {
      if (busy > 0) return false;
    } else if (busy >= this.maxAttackers) return false;
    enemy.token = true;
    return true;
  }

  releaseToken(enemy) {
    enemy.token = false;
  }

  /** Keep bodies out of each other and out of the player. */
  separate(enemy) {
    const pos = enemy.position;
    for (const other of this.enemies) {
      if (other === enemy || !other.alive) continue;
      const o = other.position;
      if (Math.abs(o.y - pos.y) > 1.2) continue;
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const min = enemy.radius + other.radius + 0.12;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = ((min - d) / d) * (other.size / (enemy.size + other.size));
      pos.x += dx * push;
      pos.z += dz * push;
    }
    const P = this.player;
    if (P.alive && Math.abs(P.y - pos.y) < 1.2) {
      const dx = pos.x - P.x;
      const dz = pos.z - P.z;
      const min = enemy.radius + 0.38;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (min - d);
        pos.z += (dz / d) * (min - d);
      }
    }
  }

  /**
   * Which way an enemy should walk to reach the player. Unit XZ into `out`.
   * @returns {boolean} false to stand still
   */
  steer(enemy, out) {
    const P = this.player;
    const pos = enemy.position;
    const zone = enemy.zone;
    const dx = P.x - pos.x;
    const dz = P.z - pos.z;
    const dist = Math.hypot(dx, dz);
    // Close and in plain sight on the same level: straight at them.
    const direct = zone === P.zone && Math.abs(P.y - pos.y) < 0.9 && (dist < 2.6 || zone === 'outside' && dist < 9) &&
      this.world.sight(pos.x, pos.y + 1.2, pos.z, P.x, P.y + 1.2, P.z) &&
      this.world.sight(pos.x, pos.y + 0.6, pos.z, P.x, P.y + 0.6, P.z);
    if (direct) {
      out.x = dx / (dist || 1);
      out.z = dz / (dist || 1);
      return dist > 0.05;
    }
    if (!this.fields) return false;
    if (zone === 'stairs') return this._steerStairs(enemy, out);
    if (zone === P.zone) {
      const field = zone === 'home' ? this.fields.home : this.fields.outside;
      if (field.direction(pos.x, pos.z, out)) return true;
      out.x = dx / (dist || 1);
      out.z = dz / (dist || 1);
      return dist > 0.05;
    }
    if (P.zone === 'stairs' || (zone === 'home' && P.zone === 'outside') || (zone === 'outside' && P.zone === 'home')) {
      const field = zone === 'home' ? this.fields.homePortal : this.fields.outsidePortal;
      const portal = zone === 'home' ? this.portals.homeToStairs : this.portals.outsideToStairs;
      if (Math.hypot(portal.x - pos.x, portal.z - pos.z) < 1.2) {
        // At the doorway: step onto the stairs proper.
        out.x = zone === 'home' ? 1 : 1;
        out.z = 0;
        return true;
      }
      return field.direction(pos.x, pos.z, out);
    }
    return false;
  }

  _steerStairs(enemy, out) {
    const path = this.level.stairPath;
    const P = this.player;
    const pos = enemy.position;
    const se = path.project(pos.x, pos.y, pos.z);
    let sp;
    if (P.zone === 'stairs') sp = path.project(P.x, P.y, P.z);
    else if (P.zone === 'home') sp = -2;
    else sp = path.length + 2;
    const ahead = sp > se ? 1.1 : -1.1;
    if (Math.abs(sp - se) < 0.3) return false;
    path.pointAt(se + ahead, _v);
    const dx = _v.x - pos.x;
    const dz = _v.z - pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return false;
    out.x = dx / l;
    out.z = dz / l;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* combat                                                              */
  /* ------------------------------------------------------------------ */

  findTarget(origin, facing, config) {
    const half = Math.cos(MathUtils.degToRad(MathUtils.clamp(config.cone, 0, 360)) * 0.5);
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    let best = null;
    let bestScore = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spawnFx?.kind === 'climb') continue;
      if (Math.abs(enemy.position.y - origin.y) > 1.4) continue;
      const dx = enemy.position.x - origin.x;
      const dz = enemy.position.z - origin.z;
      const distance = Math.hypot(dx, dz) - enemy.radius + 0.36;
      if (distance > config.range) continue;
      if (distance < 1e-3) return enemy;
      const alignment = (dx * fx + dz * fz) / Math.max(1e-3, Math.hypot(dx, dz));
      if (alignment < half) continue;
      if (!this.world.sight(origin.x, origin.y + 1.1, origin.z, enemy.position.x, enemy.position.y + 1.1, enemy.position.z)) continue;
      const score = distance * (2 - alignment);
      if (score >= bestScore) continue;
      bestScore = score;
      best = enemy;
    }
    return best;
  }

  /** Every standing body inside an arc — what a sword swing actually hits. */
  inArc(origin, facing, reach, cone, out = []) {
    out.length = 0;
    const half = Math.cos(MathUtils.degToRad(cone) * 0.5);
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (Math.abs(enemy.position.y - origin.y) > 1.4) continue;
      const dx = enemy.position.x - origin.x;
      const dz = enemy.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d - enemy.radius > reach) continue;
      if (d > 0.5 && (dx * fx + dz * fz) / d < half) continue;
      if (!this.world.sight(origin.x, origin.y + 1.1, origin.z, enemy.position.x, enemy.position.y + 1.1, enemy.position.z)) continue;
      out.push(enemy);
    }
    return out;
  }

  /** Kept for the summons, which fell outright. */
  kill(enemy, x, z, force = settings.kick) {
    if (!enemy?.alive) return false;
    if (!enemy.die(x, z, force, force.slices === true)) return false;
    this.kills++;
    return true;
  }

  pushOut(position, radius) {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spawnFx) continue;
      if (Math.abs(enemy.position.y - position.y) > 1.2) continue;
      const min = radius + enemy.radius - 0.1;
      const dx = position.x - enemy.position.x;
      const dz = position.z - enemy.position.z;
      const squared = dx * dx + dz * dz;
      if (squared >= min * min) continue;
      const distance = Math.sqrt(squared);
      if (distance < 1e-4) { position.x += min; continue; }
      const push = (min - distance) / distance;
      position.x += dx * push;
      position.z += dz * push;
    }
  }

  /* ------------------------------------------------------------------ */

  /** Take everyone off, corpses included. */
  clear(filter = null) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (filter && !filter(e)) continue;
      e.dispose();
      this.enemies.splice(i, 1);
    }
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    if (this.source) disposeObject(this.source);
    this.source = null;
  }
}

function cloneGrid(grid) {
  const g = Object.create(Object.getPrototypeOf(grid));
  Object.assign(g, grid);
  g.dist = new Float32Array(grid.dist.length).fill(Infinity);
  g.goal = -1;
  g._heap = new grid._heap.constructor(grid.open.length);
  return g;
}
