import { TextureLoader, Vector3 } from 'three';
import { Renderer } from './Renderer.js';
import { Time } from './Time.js';
import { PlayerCamera } from './PlayerCamera.js';
import { Input } from './Input.js';
import { frame } from './FrameUniforms.js';

import { Environment } from '../world/Environment.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { Sky } from '../world/Sky.js';
import { Moon } from '../world/Moon.js';
import { Ground } from '../world/Ground.js';
import { Terrain } from '../world/Terrain.js';
import { GroundFog } from '../world/GroundFog.js';
import { Leaves } from '../world/Leaves.js';
import { ContactShadows } from '../world/ContactShadows.js';
import { World, floorY, HOME_FLOOR, FH, PLINTH } from '../world/World.js';
import { Level } from '../world/Level.js';
import { LightPool } from '../world/LightPool.js';

import { AssetLoader } from '../loaders/AssetLoader.js';
import { CharacterController } from '../animation/CharacterController.js';
import { ThirdPersonController } from '../animation/ThirdPersonController.js';
import { EnemyManager, zoneOf } from '../combat/EnemyManager.js';
import { TargetMarking } from '../combat/TargetMarking.js';
import { Ragdoll } from '../combat/Ragdoll.js';

import { PostProcessing } from '../postprocessing/PostProcessing.js';
import { WeaponFire } from '../vfx/WeaponFire.js';
import { BloodBurst } from '../vfx/BloodBurst.js';
import { ShadowCharacter } from '../vfx/ShadowCharacter.js';
import { Judgement } from '../vfx/Judgement.js';
import { BladeStorm } from '../vfx/BladeStorm.js';
import { TargetRings } from '../vfx/TargetRings.js';
import { TargetMarkers } from '../vfx/TargetMarkers.js';
import { Fire } from '../vfx/Fire.js';
import { EquipmentLibrary } from '../equipment/EquipmentLibrary.js';
import { EquipmentManager } from '../equipment/EquipmentManager.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { Toast } from '../ui/Toast.js';
import { ActionHUD } from '../ui/ActionHUD.js';
import { TargetHotkeys } from '../ui/TargetHotkeys.js';
import { Sound } from '../game/Sound.js';
import { Game } from '../game/Game.js';

import { settings } from '../config/settings.js';

const HDR_URL = './hdri/spruit_sunrise.hdr';
const isTouch = matchMedia('(pointer: coarse)').matches;

// Game-tuned look (the template ships tuned for an open night field).
Object.assign(settings.locomotion, { walkSpeed: 1.7, runSpeed: 4.6 });
Object.assign(settings.terrain, { amplitude: 0 });
Object.assign(settings.environment, { floorTextureSet: 'stone', floorTextureScale: 2.2, shadowExtent: 26 });
Object.assign(settings.post, { bloomStrength: 0.2, bloomRadius: 0.45, bloomThreshold: 1.0, vignette: 0.9, grain: 0.035, contrast: 1.06, saturation: 0.95 });
Object.assign(settings.groundFog, { count: 120, opacity: 0.06 });
Object.assign(settings.leaves.drift, { count: 160 });
Object.assign(settings.leaves.litter, { perCell: 9 });
Object.assign(settings.kick, { range: 3.0, standoff: 1.05, maxWarp: 2.2, cancelAt: 0.58, hitStop: 0.06 });
Object.assign(settings.slashHit, { range: 4.2, maxWarp: 3.0, cancelAt: 0.5, timeScale: 1.45 });
Object.assign(settings.crouchSlash, { range: 8.0, maxWarp: 6.5, cancelAt: 0.8 });
settings.shadowCharacter.marking.range = 22;
settings.judgement.marking.range = 26;
settings.enemies.ragdoll.friction = 0.7;
if (isTouch) {
  // Phones: the same game, a lighter frame.
  Object.assign(settings.post, { bloomStrength: 0, grain: 0 });
  Object.assign(settings.groundFog, { count: 50 });
  Object.assign(settings.leaves.drift, { count: 50 });
  Object.assign(settings.leaves.litter, { perCell: 4 });
  settings.environment.shadowExtent = 18;
  settings.targetRing.hotkeys.enabled = false;
}

/**
 * Builds every system and runs the frame. Story, rules and UI live in
 * `game/Game.js`; this file only orders the per-frame updates.
 */
export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = new Time();
    this.elapsed = 0;
    this.paused = false;
    this.isTouch = isTouch;
    this._raf = 0;
    /** simulation speed multipliers owned by the game: slow-mo, freeze */
    this.timeScale = 1;
    this._hitStop = 0;
    this._hitStopScale = 1;

    this.renderer = new Renderer(canvas);
    this.world = new World();
    this.cam = new PlayerCamera(canvas, this.world);
    this.camera = this.cam.camera;
    // The template's systems ask the "rig" for an azimuth and to shake.
    this.rig = { get azimuth() { return 0; }, shake: (a) => this.cam.shake(a) };
    Object.defineProperty(this.rig, 'azimuth', { get: () => this.cam.azimuth });

    this.environment = new Environment(this.renderer, this.camera);
    if (isTouch) this.environment.sun.shadow.mapSize.set(1024, 1024);
    this.scene = this.environment.scene;

    /* ---- outside ---- */
    this.atmosphere = new Atmosphere();
    this.sky = new Sky(this.atmosphere);
    this.moon = new Moon();
    this.terrain = new Terrain();
    this.ground = new Ground(this.environment, { terrain: this.terrain, atmosphere: this.atmosphere });
    this.groundFog = new GroundFog({ terrain: this.terrain, cache: this.ground.cache, atmosphere: this.atmosphere });
    this.leaves = new Leaves({ terrain: this.terrain, cache: this.ground.cache, environment: this.environment, atmosphere: this.atmosphere });
    this.contactShadows = new ContactShadows(this.renderer, { size: 2.6, height: 2.4, blur: 2.0, resolution: isTouch ? 128 : 256 });
    this.scene.add(this.sky.mesh, this.moon.mesh, this.ground.mesh, this.groundFog.mesh, this.leaves.group, this.contactShadows.group);

    /* ---- the building ---- */
    this.level = new Level(this.world, this.scene, new TextureLoader());
    this.level.buildNav();
    for (const m of this.level.worldMaterials) {
      this.environment.excludeFromKeyLights(m);
      if (m.isMeshStandardMaterial && !m.transparent) this.atmosphere.patch(m);
    }
    this.lightPool = new LightPool(this.scene, this.level.lights, isTouch ? 6 : 10);
    for (const l of this.lightPool.lights) l.decay = 1.4;
    this.fire = new Fire(this.level.fires);
    this.scene.add(this.fire.points);

    /** What the template's ground-followers ask: a height under a point, at a height. */
    this.surface = {
      refY: 0,
      heightAt: (x, z, y) => this.world.heightAt(x, z, y ?? this.surface.refY),
      pushParticle: (p) => this.world.collide(p, 0.07, p.y - 0.4, 0.8)
    };

    /* ---- character ---- */
    this.character = new CharacterController(this.environment);
    this.scene.add(this.character.root);
    this.input = new Input(window, canvas);
    this.controller = new ThirdPersonController(this.character, this.input, this.rig);

    /* ---- combat ---- */
    this.blood = new BloodBurst();
    this.scene.add(this.blood.mesh);
    this.enemies = new EnemyManager({
      terrain: this.surface,
      world: this.world,
      level: this.level,
      effects: { onBlood: (p, d, c, s) => this.blood.emit(p, d, c, s) }
    });
    this.scene.add(this.enemies.group);
    this.enemies.camera = this.camera;
    this.controller.setEnemies(this.enemies);
    this.targetRings = new TargetRings({});
    this.scene.add(this.targetRings.mesh);
    this._locked = new Map();
    this._readyMoves = new Set();
    this._keyLists = [];

    this.shadows = new ShadowCharacter(this.character, {
      terrain: this.surface,
      enemies: this.enemies,
      onStrike: (enemy, x, z, force) => this.game.summonStrike(enemy, x, z, force, 4, 'shadow')
    });
    this.scene.add(this.shadows.group);
    this.judgement = new Judgement({
      terrain: this.surface,
      enemies: this.enemies,
      onStrike: (enemy, x, z, force) => this.game.summonStrike(enemy, x, z, force, 14, 'judgement')
    });
    this.scene.add(this.judgement.group);
    this.blades = new BladeStorm({
      terrain: this.surface,
      equipment: () => this.equipment,
      onStrike: (enemy, x, z, force) => this.game.summonStrike(enemy, x, z, force, 6, 'blade')
    });
    this.scene.add(this.blades.group);

    const aimCentre = (m) => { m._trackPointer = () => {}; m._pointer.x = 0; m._pointer.y = 0; return m; };
    this.marking = aimCentre(new TargetMarking({
      camera: this.camera, enemies: this.enemies, domElement: window,
      config: () => settings.shadowCharacter.marking,
      onMark: (count, wanted) => { if (count < wanted) this.toast.show(`已標記 ${count} / ${wanted}`); },
      onCancel: () => this.toast.show('標記取消'),
      onComplete: (targets) => this.game.castShadows(targets)
    }));
    this.judgeMarking = aimCentre(new TargetMarking({
      camera: this.camera, enemies: this.enemies, domElement: window,
      config: () => settings.judgement.marking,
      onCancel: () => this.toast.show('標記取消'),
      onComplete: (targets) => this.game.castJudgement(targets[0])
    }));
    this.flightMarking = aimCentre(new TargetMarking({
      camera: this.camera, enemies: this.enemies, domElement: window,
      config: () => settings.flight.marking,
      onComplete: (targets) => this._forgeBlade(targets[0])
    }));
    this.input.marking = () => this.marking.active || this.judgeMarking.active || this.flightMarking.active;
    this.targetMarkers = new TargetMarkers();
    this.scene.add(this.targetMarkers.mesh);
    this._marked = [];

    /* ---- post + UI ---- */
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    this.loading = new LoadingScreen();
    this.toast = new Toast();
    this.actionHUD = new ActionHUD();
    this.targetHotkeys = new TargetHotkeys({ camera: this.camera, domElement: canvas });
    this.sound = new Sound();
    this.equipment = null;
    this.weaponFire = null;
    this.playerRagdoll = null;

    this.renderer.onResize((w, h, pr) => {
      this.cam.resize(w, h);
      this.post.setSize(w, h, pr);
    });
    this.cam.resize(window.innerWidth, window.innerHeight);

    this.game = new Game(this);
  }

  /* ------------------------------------------------------------------ */

  async load() {
    const assets = new AssetLoader();
    this.loading.setProgress(0.05, '點亮城市…');
    const hdr = await assets.loadHDR(HDR_URL);
    await this.environment.loadEnvironment(hdr);
    frame.uEnvMap.value = this.environment.equirect;

    this.loading.setProgress(0.25, '鋪上廣場的石板…');
    await this.ground.loadTextures(assets);
    await this.leaves.load(assets, this.renderer);
    await this.moon.load(assets);
    this.terrain.update();
    this.ground.update(0, 0, 0);

    this.loading.setProgress(0.45, '喚醒你的身體（角色與動作）…');
    await this.character.load(assets);

    this.loading.setProgress(0.7, '黑雨落下…');
    await this.enemies.load(assets, this.character.motionSources);
    this.enemies.buildFields();
    for (const move of this.character.attacks) {
      move.onSwing = (attack, target) => this.game.playerSwing(attack, target);
    }
    this.controller.onAttackStart = (move) => this.game.onAttackStart(move);
    this.controller.onDodge = () => this.game.onDodge();

    this.loading.setProgress(0.78, '鍛造天罰之拳…');
    await this.judgement.load(assets);

    this.loading.setProgress(0.84, '爺爺的刀…');
    const library = new EquipmentLibrary(assets, this.character.materialLibrary);
    this.equipment = new EquipmentManager(this.character, library);
    this.equipment.autosave = false;
    await this.equipment.equip('sword');
    await this.equipment.equip('scabbard');
    this.weaponFire = new WeaponFire({ equipment: this.equipment });
    this.weaponFire.attachTo(this.scene);

    this.loading.setProgress(0.88, '種樹…');
    try {
      const gltf = await assets.loadGLTF('./models/environment/tree.glb');
      this.level.plantTrees(gltf.scene);
    } catch (e) {
      console.warn('trees failed', e);
    }

    this.loading.setProgress(0.9, '編譯著色器…');
    this.game.prepare();
    try {
      await this.renderer.gl.compileAsync(this.scene, this.camera);
    } catch (e) {
      console.warn('compileAsync failed', e);
    }
    await assets.settled();
    assets.dispose();
    this.loading.setProgress(1, '準備完成');
    this.loading.hide();
    this.start();
    this.game.showTitle();
  }

  start() {
    this.time.reset();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */

  hitStop(duration, scale) {
    this._hitStop = Math.max(this._hitStop, duration);
    this._hitStopScale = Math.min(this._hitStopScale === 1 ? 1 : this._hitStopScale, scale);
    if (this._hitStop === duration) this._hitStopScale = scale;
  }

  _toggleFlight() {
    const flight = this.character.flight;
    if (!flight?.available) return;
    if (flight.active) {
      flight.stop();
      this.flightMarking.end();
      const loosed = this.blades.launch();
      this.toast.show(loosed > 0 ? `落地 —— ${loosed} 把飛劍齊發` : '落地');
      return;
    }
    this.marking.end();
    this.judgeMarking.end();
    this.shadows.dismiss();
    this.judgement.dismiss();
    this.targetRings.clear();
    this.targetHotkeys.clear();
    this.character.jump?.cancel();
    this.character.hop?.cancel();
    for (const move of this.character.attacks ?? []) move.cancel();
    flight.start();
    this.flightMarking.begin();
    this.toast.show(this.isTouch ? '萬劍：對準敵人點畫面鍛劍 · 「閃」齊射 · 「劍」落地' : '萬劍：對準敵人點左鍵鍛劍 · Space 齊射 · X 落地', 3500);
  }

  _forgeBlade(enemy) {
    const result = this.blades.mark(enemy);
    if (result === 'full') this.toast.show('劍陣已滿 —— Space 齊射');
    if (this.character.flight?.flying) this.flightMarking.begin();
  }

  _loose() {
    const sent = this.blades.launch();
    if (sent > 0) this.toast.show(`${sent} 把飛劍`);
  }

  _updateTargetRings(dt, position) {
    const locked = this._locked;
    const ready = this._readyMoves;
    for (const keys of locked.values()) { keys.length = 0; this._keyLists.push(keys); }
    locked.clear();
    ready.clear();
    if (this.character.flight?.active || !this.game.playing) {
      this.targetRings.update(dt, locked, this.elapsed);
      this.targetHotkeys.update(dt, locked, ready);
      return;
    }
    const facing = this.character.facing;
    for (const move of this.character.attacks ?? []) {
      if (!move.available || !move.config.enabled) continue;
      const enemy = this.enemies.findTarget(position, facing, move.config);
      if (!enemy) continue;
      if (move.locked || move.canStart()) ready.add(move.configKey);
      let keys = locked.get(enemy);
      if (!keys) { keys = this._keyLists.pop() ?? []; locked.set(enemy, keys); }
      keys.push(move.configKey);
    }
    this.targetRings.update(dt, locked, this.elapsed);
    this.targetHotkeys.update(dt, locked, ready);
  }

  _updateMarks(dt, position) {
    this.marking.update(dt, position);
    this.judgeMarking.update(dt, position);
    this.flightMarking.update(dt, position);
    const aiming = this.marking.active ? this.marking : this.judgeMarking.active ? this.judgeMarking : this.flightMarking.active ? this.flightMarking : null;
    const marked = this._marked;
    marked.length = 0;
    if (aiming) for (const e of aiming.marks) marked.push(e);
    else {
      for (const e of this.shadows.assignments) marked.push(e);
      for (const e of this.judgement.assignments) marked.push(e);
    }
    for (const e of this.blades.assignments) if (!marked.includes(e)) marked.push(e);
    this.targetMarkers.update(dt, aiming?.hovered ?? null, marked, this.elapsed);
    document.getElementById('crosshair')?.classList.toggle('on', !!aiming);
  }

  _syncAbilities() {
    const g = this.game;
    const flight = this.character.flight;
    const airborne = flight?.active === true;
    const state = {
      leap: this.controller.dodging ? 'active' : 'ready',
      flight: airborne ? 'active' : g.canFly() ? 'ready' : 'off',
      shadows: airborne ? 'off' : this.shadows.active || this.marking.active ? 'active' : g.spirit >= 60 ? 'ready' : 'off',
      judgement: airborne || this.judgement.active ? 'off' : this.judgeMarking.active ? 'active' : g.spirit >= 40 ? 'ready' : 'off'
    };
    for (const move of this.character.attacks ?? []) {
      state[move.configKey] = !move.config.enabled ? 'off' : move.locked ? 'active' : 'ready';
    }
    this.actionHUD.update(state);
  }

  /* ------------------------------------------------------------------ */

  frame() {
    const gl = this.renderer.gl;
    gl.info.reset();
    const raw = this.time.tick();
    let scale = settings.global.timeScale * this.timeScale;
    if (this._hitStop > 0) {
      this._hitStop = Math.max(0, this._hitStop - raw);
      scale *= this._hitStopScale;
    } else this._hitStopScale = 1;
    const dt = this.paused ? 0 : raw * scale;
    this.elapsed += dt;
    frame.uTime.value = this.elapsed;
    frame.uDelta.value = dt;
    frame.uCameraNear.value = this.camera.near;
    frame.uCameraFar.value = this.camera.far;
    this.renderer.syncSettings(settings.post);

    const game = this.game;
    game.preUpdate(dt, raw);

    this.terrain.update();
    this.atmosphere.update();
    this.sky.discEnabled = !this.moon.active;
    this.sky.update(this.elapsed);
    this.moon.update();

    // The body.
    const position = this.character.position;
    if (game.playing && !this.playerRagdoll) {
      const prevX = position.x;
      const prevZ = position.z;
      this.controller.update(dt);
      this.world.collide(position, 0.34, position.y, 1.7);
      this.enemies.pushOut(position, 0.36);
      this.world.collide(position, 0.34, position.y, 1.7);
      if (dt > 0) game.moved(Math.hypot(position.x - prevX, position.z - prevZ));
    }
    const groundY = this.world.heightAt(position.x, position.z, position.y + 0.4);
    const lift = this.character.flight?.lift ?? 0;
    if (!this.playerRagdoll) {
      const target = groundY + lift;
      position.y += (target - position.y) * Math.min(1, dt * 16);
      if (Math.abs(target - position.y) < 0.004) position.y = target;
      this.character.update(dt);
    } else {
      this.playerRagdoll.update(dt);
    }
    this.surface.refY = position.y + 0.6;

    this.blood.sync(this.elapsed);
    const P = this.enemies.player;
    P.x = position.x;
    P.y = position.y;
    P.z = position.z;
    P.zone = zoneOf(position.x, position.y, position.z);
    P.alive = game.alive && game.playing;
    P.invisible = this.controller.invulnerable;
    this.enemies.update(dt);
    this._updateTargetRings(dt, position);
    this._updateMarks(dt, position);

    this.environment.setFocus(position.x, position.z, groundY);
    this.environment.update();
    // Indoors the power is out: the moon key, the sky and the fittings all drop.
    const indoor = game.indoor;
    const env = this.environment;
    env.sun.intensity *= 1 - 0.62 * indoor;
    env.rim.intensity *= 1 - 0.55 * indoor;
    env.hemi.intensity *= 1 - 0.6 * indoor;
    env.ambient.intensity *= 1 - 0.45 * indoor;
    this.lightPool.master = 1 - 0.42 * indoor;
    this.equipment?.update();
    if (this.weaponFire) this.weaponFire.update(dt, this.scene);
    this.shadows.update(dt);
    this.judgement.update(dt, this.elapsed);
    this.blades.update(dt, this.elapsed, position, this.character.height);
    this._syncAbilities();

    const outside = P.zone === 'outside' || game.showOutside;
    const nearGround = position.y < 3 || game.showOutside;
    this.ground.update(this.elapsed, position.x, position.z);
    this.groundFog.mesh.visible = nearGround;
    this.leaves.group.visible = nearGround;
    if (nearGround) {
      this.groundFog.update(this.elapsed, position);
      this.leaves.update(dt, this.elapsed, position, this.controller.velocity);
    }
    this.fire.update(this.elapsed);
    this.level.cull(game.cullY ?? position.y, outside);
    this.level.update(dt, this.elapsed);

    game.update(dt, raw);

    // Camera on real time.
    this.cam.update(raw, position);
    // Hide the body when the lens is inside it.
    this.character.root.visible = this.cam.closeness > 0.7;
    this.lightPool.update(this.cam.shot ? this.cam.camera.position : position.clone().setY(position.y + 1.5), this.elapsed);
    this.sound.update(raw);

    this.contactShadows.setPosition(position.x, position.z, groundY);
    if (!this.playerRagdoll) this.contactShadows.render(this.scene);

    // Nothing indoors receives the moon's shadow; don't pay for it there.
    gl.shadowMap.needsUpdate = game.indoor < 0.95 || this.cam.shot !== null;
    this.post.sync(this.elapsed, settings.post);
    this.post.render();
  }

  /** Throw the player's body (death). */
  ragdollPlayer(x, z, force) {
    const r = new Ragdoll(this.character.bones, { terrain: this.surface });
    if (!r.valid) return;
    this.character.mixer?.stopAllAction();
    r.strike(x, z, force);
    this.playerRagdoll = r;
  }

  /** Stand back up (respawn): the mixer takes the bones back. */
  reviveBody() {
    this.playerRagdoll = null;
    const loco = this.character.locomotion;
    for (const key of ['idle', 'walk', 'run']) loco?.[key]?.play();
    loco?.rest?.();
  }
}

export { floorY, HOME_FLOOR, FH, PLINTH, Vector3 };
