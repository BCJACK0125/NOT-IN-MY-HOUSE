import { AdditiveBlending, CanvasTexture, Color, Group, MathUtils, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3 } from 'three';
import { settings } from '../config/settings.js';
import { K, KY, FH, PLINTH, HOME_FLOOR, floorY } from '../world/World.js';
import { PLAZA, VAN } from '../world/Level.js';
import { ShockRing } from '../vfx/ShockRing.js';
import { Cinematic, v3 } from './Cinematic.js';
import { UI } from './UI.js';
import { buildSteps, CHAPTERS } from './Story.js';

const _v = new Vector3();
const _w = new Vector3();

/** What each of the player's moves does to a body. */
const SWINGS = {
  kick: { damage: 1, reach: 2.15, cone: 110, sound: 'swing' },
  slashHit: { damage: 2, reach: 2.9, cone: 165, sound: 'slash' },
  crouchSlash: { damage: 3, reach: 3.1, cone: 140, sound: 'slash' }
};

const SAVE_KEY = 'nimh.save.v1';
const CHAPTER_KEY = 'nimh.chapters.v1';

/**
 * The rules and the story: health and 氣, who hit whom, checkpoints, the
 * chapter script, cutscenes, pickups and the HUD. `App` calls `preUpdate`
 * before the simulation and `update` after it.
 */
export class Game {
  constructor(app) {
    this.app = app;
    this.ui = new UI(app);
    this.cine = new Cinematic(app.cam, this.ui);
    this.mode = 'loading'; // title · cinematic · play · dead · ending
    this.maxHp = 100;
    this.hp = 100;
    this.spirit = 0;
    this.hasSword = false;
    this.difficulty = 1;
    this.flags = {};
    this.interactables = [];
    this.pickups = [];
    this.stepIndex = -1;
    this.step = null;
    this.checkpoint = null;
    this.combo = 0;
    this._comboTimer = 0;
    this.stats = { kills: 0, maxCombo: 0, deaths: 0, perfect: 0, time: 0, damage: 0 };
    this._slowmo = 0;
    this._dead = 0;
    this._beat = 0;
    this._stepAcc = 0;
    this.showOutside = false;
    this.cullY = null;
    this._timers = [];
    this.boss = null;
    this.dawn = 0;
    this._dawnFrom = null;
    this.indoor = 0;
    this.hidePlayer = false;

    const enemies = app.enemies;
    enemies.onNotice = (e) => {
      if (this.mode === 'play' && this._near(e, 14)) app.sound.growl(e.type.boss || e.kind === 'brute');
    };
    enemies.onWindup = (e) => {
      if (this._near(e, 10)) app.sound.windup();
    };
    enemies.onEnemyStrike = (e, attack) => this._enemyStrike(e, attack);

    this.slamRing = new ShockRing({});
    app.scene.add(this.slamRing.mesh);

    this.steps = buildSteps(this);
    this._bindKeys();
  }

  get playing() {
    return this.mode === 'play';
  }

  get alive() {
    return this.hp > 0;
  }

  /* ------------------------------------------------------------------ */
  /* setup                                                               */
  /* ------------------------------------------------------------------ */

  /** Called once after loading: everything that must exist before the first frame. */
  prepare() {
    const app = this.app;
    this._setSword(false, true);
    // Place the body in the lift so the shader warm-up sees it there.
    this._placePlayer(this.steps[0].spawn);
    this.spawnCrowd();
    const fridgeAt = this.P(4.15, 9.25);
    this.addInteract({
      persist: true,
      pos: fridgeAt,
      r: 1.4,
      enabled: () => this.stepIndex >= 3 && !this.flags.fridgeUsed,
      prompt: () => (this.hp < this.maxHp ? '打開冰箱吃點東西（回復）' : '冰箱（現在還不餓）'),
      onUse: (g) => {
        if (g.hp >= g.maxHp) return;
        g.flags.fridgeUsed = true;
        g.heal(100);
        g.say('冰的可樂和媽包的水餃。……活過來了。', 3);
      }
    });
  }

  showTitle() {
    this.mode = 'title';
    this.ui.title(true);
    this.ui.hud(false);
    const save = this._loadSave();
    this.ui.continueButton(!!save);
    this.ui.chapterSelect(CHAPTERS, this.unlockedChapters());
  }

  newGame({ intro = true, fromSave = null, chapter = null } = {}) {
    const app = this.app;
    app.sound.init();
    app.cam.clearShot();
    this.ui.title(false);
    this.difficulty = this.ui.difficulty();
    this.hp = this.maxHp;
    this.spirit = 0;
    this.stats = { kills: 0, maxCombo: 0, deaths: 0, perfect: 0, time: 0, damage: 0 };
    this.flags = {};
    this.dawn = 0;
    this._timers.length = 0;
    this._restoreNight();
    app.enemies.clear();
    for (const p of this.pickups) p.group.removeFromParent();
    this.pickups.length = 0;
    this.spawnCrowd();
    this._setSword(false);
    this.hidePlayer = false;
    if (chapter && chapter.step !== 'lift') {
      // Straight into a chapter from the title: the world as the story would
      // have left it, then that chapter's own opening.
      const start = this.steps.findIndex((s) => s.id === chapter.step);
      this._applyStepFlags(start);
      this._setSword(start > this.steps.findIndex((s) => s.id === 'sword'));
      this.spirit = 40;
      if (chapter.id === 'boss') { app.enemies.clear((e) => e.tag === 'crowd'); this.flags.bossSeen = false; }
      this.goto(start, { checkpoint: true, place: true });
      if (this.mode !== 'cinematic') this._begin();
      return;
    }
    const start = fromSave ? this.steps.findIndex((s) => s.id === fromSave.step) : 0;
    if (fromSave && start > 0) {
      this._setSword(!!fromSave.sword);
      this.spirit = fromSave.spirit ?? 0;
      this.stats = { ...this.stats, ...(fromSave.stats ?? {}) };
      this._applyStepFlags(start);
      if (start > this.steps.findIndex((s) => s.id === 'plaza')) app.enemies.clear((e) => e.tag === 'crowd');
      this.goto(start, { checkpoint: true, place: true, retry: true });
      this._begin();
      return;
    }
    this.goto(0, { checkpoint: true, quiet: intro, place: true });
    if (intro) this.steps[0].prologue();
    else this._begin();
  }

  /** Hand control to the player. */
  _begin() {
    this.mode = 'play';
    this.ui.hud(true);
    this.app.cam.lock();
    this.app.controller.enabled = true;
    this.app.input.enabled = true;
  }

  spawnCrowd() {
    const E = this.app.enemies;
    E.clear((e) => e.tag === 'crowd');
    const spots = [
      ['shade', -9, 6, true], ['shade', -12, 10, false], ['shade', -16, 4, true], ['shade', -10.5, 16, false],
      ['shade', -18, 19, false], ['brute', -14, 13, false], ['shade', -7, 24, true], ['shade', -22, 9, false],
      ['shade', 6, 27, false], ['shade', 10, 30, true], ['runner', 15, 33, false], ['shade', 3, 34, false],
      ['shade', -4, 30, false]
    ];
    for (const [kind, x, z, crouch] of spots) {
      E.spawn(kind, { x, z, y: 0, yaw: Math.random() * 6.28, crouch, tag: 'crowd' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* story                                                               */
  /* ------------------------------------------------------------------ */

  goto(index, { checkpoint = false, quiet = false, place = false, retry = false } = {}) {
    this.step?.exit?.(this);
    this.stepIndex = index;
    this.step = this.steps[index];
    if (!this.step) return;
    if (place) {
      for (let i = this.interactables.length - 1; i >= 0; i--) if (!this.interactables[i].persist) this.interactables.splice(i, 1);
      if (this.step.spawn) this._placePlayer(this.step.spawn);
    }
    if (checkpoint || this.step.checkpoint) this._saveCheckpoint();
    const chapter = CHAPTERS.find((c) => c.step === this.step.id);
    if (chapter) this.unlockChapter(chapter.id);
    this.step.enter?.(this, { quiet, retry });
    this.ui.objective(this.step.chapter ?? '', this._objectiveText());
  }

  next() {
    this.goto(this.stepIndex + 1);
  }

  _objectiveText() {
    const o = this.step?.objective;
    return typeof o === 'function' ? o(this) : o ?? '';
  }

  _saveCheckpoint() {
    const p = this.app.character.position;
    this.checkpoint = {
      index: this.stepIndex,
      sword: this.hasSword,
      spirit: this.spirit,
      flags: { ...this.flags }
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ step: this.step.id, sword: this.hasSword, spirit: this.spirit, stats: this.stats, diff: this.difficulty }));
    } catch {
      /* storage unavailable */
    }
  }

  /** Chapters reached so far, for the title screen's chapter select. */
  unlockedChapters() {
    try {
      return new Set(JSON.parse(localStorage.getItem(CHAPTER_KEY) || '["prologue"]'));
    } catch {
      return new Set(['prologue']);
    }
  }

  unlockChapter(id) {
    const set = this.unlockedChapters();
    if (set.has(id)) return;
    set.add(id);
    try { localStorage.setItem(CHAPTER_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
  }

  /** From the chapter select. */
  startChapter(id) {
    const chapter = CHAPTERS.find((c) => c.id === id);
    if (!chapter) return;
    if (chapter.step === 'lift') this.newGame({ intro: true });
    else this.newGame({ chapter });
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  continueFromSave() {
    const save = this._loadSave();
    if (!save) return this.newGame();
    this.ui.setDifficulty(save.diff ?? 1);
    this.newGame({ intro: false, fromSave: save });
  }

  /** Flags a later step relies on having been set by earlier ones. */
  _applyStepFlags(index) {
    for (let i = 0; i < index; i++) this.steps[i].skipTo?.(this);
  }

  /** Back to the last checkpoint after a death. */
  retry() {
    const app = this.app;
    const cp = this.checkpoint;
    if (!cp) return;
    this.stats.deaths++;
    app.reviveBody();
    if (this._camBefore) { app.cam.wantDistance = this._camBefore.d; this._camBefore = null; }
    this.hp = this.maxHp;
    this.spirit = Math.max(cp.spirit, 30);
    this.flags = { ...cp.flags };
    this._setSword(cp.sword);
    app.shadows.dismiss({ immediate: true });
    app.judgement.dismiss({ immediate: true });
    app.blades.dismiss({ immediate: true });
    app.character.flight?.cancel();
    app.marking.end();
    app.judgeMarking.end();
    app.flightMarking.end();
    // Everyone this checkpoint (or later) put on the field goes; the step
    // stands them up again.
    const tags = new Set(this.steps.slice(cp.index).flatMap((s) => s.tags ?? [s.id]));
    if (cp.index <= this.steps.findIndex((s) => s.id === 'exit')) tags.add('crowd');
    app.enemies.clear((e) => tags.has(e.tag));
    if (tags.has('crowd')) this.spawnCrowd();
    for (const p of this.pickups.filter((p) => p.dropped)) this._removePickup(p);
    this.boss = null;
    this.ui.boss(null);
    this.ui.gameover(false);
    this.goto(cp.index, { quiet: false, place: true, retry: true });
    this._begin();
  }

  /* ------------------------------------------------------------------ */
  /* helpers for the story                                               */
  /* ------------------------------------------------------------------ */

  /** Plan metres (Mi-Casa) on a storey → world point. */
  P(u, w, floor = HOME_FLOOR, dy = 0) {
    return new Vector3(u * K, floorY(floor) + dy * KY, w * K);
  }

  _placePlayer(spawn) {
    const app = this.app;
    const p = app.character.position;
    p.copy(spawn.pos);
    settings.character.facing = spawn.yaw;
    app.character.setFacing(spawn.yaw);
    app.controller.velocity.set(0, 0);
    app.cam.faceHeading(spawn.yaw, spawn.pitch ?? 0.25);
    app.cam.snap(p);
  }

  placePlayer(spawn) {
    this._placePlayer(spawn);
  }

  spawn(kind, at, tag) {
    return this.app.enemies.spawn(kind, { ...at, tag });
  }

  alive(tag) {
    return this.app.enemies.countAlive(tag);
  }

  wakeTag(tag) {
    for (const e of this.app.enemies.enemies) if (e.alive && e.tag === tag) e.wake();
  }

  later(seconds, fn) {
    this._timers.push({ t: seconds, fn });
  }

  addInteract(def) {
    const it = { r: 1.7, enabled: true, ...def };
    this.interactables.push(it);
    return it;
  }

  removeInteract(it) {
    const i = this.interactables.indexOf(it);
    if (i >= 0) this.interactables.splice(i, 1);
  }

  chapter(small, big) {
    this.ui.chapterCard(small, big);
    this.app.sound.stinger('chapter');
  }

  say(text, seconds = 3.5) {
    this.ui.subtitle(text, seconds);
  }

  cinematic(shots, onDone, opts) {
    this.mode = 'cinematic';
    const app = this.app;
    app.controller.enabled = false;
    app.input.enabled = false;
    app.input.clear();
    for (const m of app.character.attacks) m.release();
    this.cine.play(shots, (skipped) => {
      onDone?.(skipped);
      if (this.mode === 'cinematic') this._begin();
    }, opts);
  }

  _setSword(on, silent = false) {
    const app = this.app;
    this.hasSword = on;
    settings.slashHit.enabled = on;
    settings.crouchSlash.enabled = on;
    settings.fire.enabled = on;
    const sword = app.equipment?.get('sword');
    if (sword) sword.mount.visible = on;
    const sheath = app.equipment?.get('scabbard');
    if (sheath) sheath.mount.visible = on;
    if (app.level.swordProp) app.level.swordProp.visible = !on;
    if (app.level.swordGlow) app.level.swordGlow.visible = !on;
  }

  giveSword() {
    this._setSword(true);
    this.app.sound.ignite();
    this.spirit = Math.max(this.spirit, 40);
  }

  /* ------------------------------------------------------------------ */
  /* combat                                                              */
  /* ------------------------------------------------------------------ */

  onAttackStart(move) {
    const s = SWINGS[move.configKey];
    if (s) this.app.sound.swing(move.configKey !== 'kick');
  }

  onDodge() {
    this.app.sound.dodge();
    this.app.cam.fovKick = 6;
  }

  /** A player's blow lands: everyone in the arc takes it. */
  playerSwing(attack, target) {
    const app = this.app;
    const s = SWINGS[attack.configKey];
    if (!s) return;
    const pos = app.character.position;
    const facing = app.character.facing;
    const hits = app.enemies.inArc(pos, facing, s.reach, s.cone, []);
    if (target?.alive && !hits.includes(target)) {
      const d = Math.hypot(target.position.x - pos.x, target.position.z - pos.z) - target.radius;
      if (d < s.reach + 0.6 && Math.abs(target.position.y - pos.y) < 1.4) hits.push(target);
    }
    if (!hits.length) return;
    let killed = 0;
    for (const e of hits) {
      const dx = e.position.x - pos.x;
      const dz = e.position.z - pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = (dx / l) * 0.6 + Math.sin(facing) * 0.4;
      const z = (dz / l) * 0.6 + Math.cos(facing) * 0.4;
      const n = Math.hypot(x, z) || 1;
      if (this.damageEnemy(e, s.damage, x / n, z / n, attack.config, 'player') === 'dead') killed++;
    }
    const cfg = attack.config;
    app.hitStop(killed ? cfg.hitStop : cfg.hitStop * 0.6, killed ? cfg.hitStopScale : 0.12);
    app.cam.shake(killed ? cfg.shake : cfg.shake * 0.5);
    if (attack.configKey === 'kick') app.sound.hit(killed > 0);
    else if (killed) app.sound.cut();
    else app.sound.hit(false);
  }

  /** A summon's blow (shadow / fist / blade). */
  summonStrike(enemy, x, z, force, damage, kind) {
    const r = this.damageEnemy(enemy, damage, x, z, force, kind);
    if (!r) return;
    if (kind === 'judgement' && r === 'dead') {
      this.app.hitStop(force.hitStop, force.hitStopScale);
    }
    this.app.cam.shake((force.shake ?? 0.2) * (kind === 'shadow' ? 0.5 : 1));
  }

  damageEnemy(enemy, damage, x, z, force, source = 'player') {
    const app = this.app;
    if (!enemy?.alive) return null;
    const result = enemy.hurt(damage, x, z, force);
    if (!result) return null;
    this.stats.damage += damage;
    _v.copy(enemy.position);
    _v.y += 1.3 * enemy.size;
    this.ui.damageNumber(_v, result === 'dead' ? '✕' : `${damage}`, result === 'dead' ? 'crit' : '');
    if (result !== 'dead') {
      _w.set(x, 0.4, z).normalize();
      app.blood.emit(_v, _w, 26, 2.6);
    }
    // combo
    this.combo++;
    this._comboTimer = 2.6;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.ui.combo(this.combo);
    this.addSpirit(result === 'dead' ? 12 : 4);
    if (result === 'dead') {
      this.stats.kills++;
      app.enemies.kills++;
      if (Math.random() < (enemy.type.drop ?? 0.15)) this.dropPickup(enemy.position, enemy.type.boss ? 3 : 1);
      if (enemy === this.boss) this._bossDown();
    } else if (enemy === this.boss) {
      this.step?.onBossHit?.(this, enemy);
    }
    if (enemy.type.boss || enemy.kind === 'brute') this.ui.boss(enemy === this.boss ? enemy : this.ui.bossTarget);
    return result;
  }

  addSpirit(n) {
    const before = this.spirit;
    this.spirit = Math.min(100, this.spirit + n);
    if (before < 40 && this.spirit >= 40 && !this.flags.toldJudgement) {
      this.flags.toldJudgement = true;
      this.app.toast.show('氣已滿 40：按 C 標記敵人，召喚「天罰」', 4200);
    } else if (before < 60 && this.spirit >= 60 && !this.flags.toldShadows) {
      this.flags.toldShadows = true;
      this.app.toast.show('氣已滿 60：按 V 標記兩個敵人，放出「影分身」', 4200);
    }
  }

  canFly() {
    return this.hasSword && this.spirit >= 100 && this.app.enemies.player.zone === 'outside' && settings.flight.enabled;
  }

  castShadows(targets) {
    if (this.spirit < 60) return;
    this.spirit -= 60;
    this.app.shadows.summon(targets);
    this.app.sound.ignite();
    this.ui.damageNumber(this.app.character.position.clone().setY(this.app.character.position.y + 2.2), '影分身', 'word');
  }

  castJudgement(enemy) {
    if (this.spirit < 40) return;
    if (this.app.judgement.cast(enemy)) {
      this.spirit -= 40;
      this.ui.damageNumber(enemy.position.clone().setY(enemy.position.y + 2.6 * enemy.size), '天罰', 'word');
    }
  }

  /** An enemy's blow resolves: did it land? */
  _enemyStrike(enemy, attack) {
    const app = this.app;
    if (this.mode !== 'play' || !this.alive) return;
    const pos = app.character.position;
    const e = enemy.position;
    const dx = pos.x - e.x;
    const dz = pos.z - e.z;
    const d = Math.hypot(dx, dz);
    const dy = Math.abs(pos.y - e.y);
    if (attack.aoe) {
      this.slamRing.burst(e.x + Math.sin(enemy.facing) * 0.8 * enemy.size, e.z + Math.cos(enemy.facing) * 0.8 * enemy.size, { ...settings.judgement.shock, radius: attack.aoe, color: '#ff5a1e', crackColor: '#ffb36b' }, 1, e.y);
      app.sound.slam();
      app.cam.shake(Math.max(0.05, 0.5 - d * 0.05));
    }
    const reach = attack.reach;
    let inFront = true;
    if (!attack.aoe) {
      const fx = Math.sin(enemy.facing);
      const fz = Math.cos(enemy.facing);
      inFront = d < 0.6 || (dx * fx + dz * fz) / d > 0.35;
    }
    const range = attack.aoe ? Math.max(reach, attack.aoe) : reach;
    if (d > range || dy > 1.3 || !inFront) return;
    if (app.controller.invulnerable) {
      this._perfectDodge(enemy);
      return;
    }
    const damage = Math.round(attack.damage * this.difficulty);
    this.hurtPlayer(damage, dx / (d || 1), dz / (d || 1), attack.aoe ? 9 : 6);
  }

  _perfectDodge(enemy) {
    const app = this.app;
    if (this._slowmo > 0) return;
    this.stats.perfect++;
    this._slowmo = 0.9;
    app.sound.perfect();
    this.addSpirit(18);
    this.ui.damageNumber(app.character.position.clone().setY(app.character.position.y + 2.1), '見切', 'word');
    this.ui.slowmo(true);
  }

  hurtPlayer(damage, x, z, shove = 6) {
    const app = this.app;
    this.hp = Math.max(0, this.hp - damage);
    this.ui.hurt(damage);
    app.sound.hurt();
    app.cam.shake(0.28);
    this.combo = 0;
    this.ui.combo(0);
    const c = app.controller;
    c.velocity.set(x * shove, z * shove);
    c.stun = 0.3;
    for (const m of app.character.attacks) if (m.locked) m.release();
    _v.copy(app.character.position);
    _v.y += 1.3;
    _w.set(x, 0.3, z).normalize();
    app.blood.emit(_v, _w, 30, 2.2);
    if (this.hp <= 0) this._die(x, z);
  }

  heal(n, quiet = false) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (!quiet && this.hp > before) {
      this.app.sound.pickup();
      this.ui.damageNumber(this.app.character.position.clone().setY(this.app.character.position.y + 2), `+${Math.round(this.hp - before)}`, 'heal');
    }
  }

  _die(x, z) {
    const app = this.app;
    this.mode = 'dead';
    this._dead = 0;
    app.controller.enabled = false;
    app.input.enabled = false;
    app.character.flight?.cancel();
    app.ragdollPlayer(x, z, { impulse: 5, lift: 3, spin: 1.5 });
    this._camBefore = { d: app.cam.wantDistance, p: app.cam.pitch };
    app.cam.wantDistance = 4.2;
    app.cam.pitch = 1.05;
    app.timeScale = 0.35;
    app.sound.roar();
    app.sound.stinger('death');
    app.cam.unlock();
  }

  /* ------------------------------------------------------------------ */
  /* pickups                                                             */
  /* ------------------------------------------------------------------ */

  dropPickup(at, count = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      this.addPickup(at.x + Math.cos(a) * 0.5 * i, at.y, at.z + Math.sin(a) * 0.5 * i, 22, true);
    }
  }

  addPickup(x, y, z, amount = 25, dropped = false) {
    const g = new Group();
    const glow = new Sprite(new SpriteMaterial({ map: crossTexture(), color: '#7dffb0', transparent: true, depthWrite: false, blending: AdditiveBlending }));
    glow.scale.set(0.55, 0.55, 1);
    const ring = new Mesh(new TorusGeometry(0.28, 0.02, 6, 24), new MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.6, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    g.add(glow, ring);
    g.position.set(x, y + 0.7, z);
    this.app.scene.add(g);
    const p = { group: g, amount, dropped, base: y + 0.7, t: Math.random() * 6 };
    this.pickups.push(p);
    return p;
  }

  _removePickup(p) {
    p.group.removeFromParent();
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /* ------------------------------------------------------------------ */
  /* boss                                                                */
  /* ------------------------------------------------------------------ */

  setBoss(enemy) {
    this.boss = enemy;
    this.ui.boss(enemy);
    this.app.sound.stinger('reveal');
  }

  _bossDown() {
    const app = this.app;
    app.sound.stinger('victory');
    this.ui.boss(null);
    app.timeScale = 0.25;
    this.later(1.6, () => { app.timeScale = 1; });
    app.sound.roar();
    app.cam.shake(0.6);
  }

  /* ------------------------------------------------------------------ */
  /* dawn                                                                */
  /* ------------------------------------------------------------------ */

  startDawn() {
    this.dawn = 0.0001;
    this._dawnFrom = snapshot();
  }

  _restoreNight() {
    if (this._dawnFrom) applyLook(this._dawnFrom, this._dawnFrom, 0);
    this.dawn = 0;
  }

  _updateDawn(dt) {
    if (this.dawn <= 0 || this.dawn >= 1 || !this._dawnFrom) return;
    this.dawn = Math.min(1, this.dawn + dt / 9);
    applyLook(this._dawnFrom, DAWN, MathUtils.smoothstep(this.dawn, 0, 1));
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */

  _bindKeys() {
    this._skipHeld = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') this._skipHeld = true;
      if (this.mode === 'cinematic') return;
      if (this.ui.noteOpen) { this.ui.note(false); this.step?.onNoteClosed?.(this); return; }
      if (e.code === 'Escape' && this.mode === 'play') { this.pause(true); return; }
      if (this.mode !== 'play' || e.repeat) return;
      const app = this.app;
      if (e.code === 'Space' && app.character.flight?.flying) { e.preventDefault(); app._loose(); return; }
      if (e.code === 'KeyV') this.ability('shadows');
      if (e.code === 'KeyC') this.ability('judgement');
      if (e.code === 'KeyX') this.ability('flight');
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') this._skipHeld = false;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || this.mode !== 'play' || this.ui.noteOpen || this.app.isTouch || this.app.cam.dragLook) return;
      if (performance.now() - (this._unlockedOnPurpose ?? 0) < 400) return;
      this.pause(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.pause(true);
    });
  }

  /** V / C / X, from the keyboard or the touch buttons. */
  ability(id) {
    const app = this.app;
    if (this.mode !== 'play') return;
    const flying = app.character.flight?.active;
    const aim = app.isTouch ? '把準心（畫面中央）對準敵人，點一下畫面標記' : '把準心對準敵人，左鍵標記';
    if (id === 'shadows' && !flying) {
      if (app.shadows.active) return;
      if (app.marking.active) { app.marking.cancel(); return; }
      if (this.spirit < 60) { app.toast.show('氣不足（影分身需要 60）'); return; }
      app.judgeMarking.end();
      app.marking.begin();
      app.toast.show(`${aim}（2 個）`, 3000);
    }
    if (id === 'judgement' && !flying) {
      if (app.judgement.active) return;
      if (app.judgeMarking.active) { app.judgeMarking.cancel(); return; }
      if (this.spirit < 40) { app.toast.show('氣不足（天罰需要 40）'); return; }
      app.marking.end();
      app.judgeMarking.begin();
      app.toast.show(aim, 3000);
    }
    if (id === 'flight') {
      if (flying) { app._toggleFlight(); return; }
      if (!this.hasSword) { app.toast.show('需要刀'); return; }
      if (app.enemies.player.zone !== 'outside') { app.toast.show('萬劍只能在戶外施展'); return; }
      if (this.spirit < 100) { app.toast.show('氣不足（萬劍需要 100）'); return; }
      this.spirit = 0;
      app._toggleFlight();
    }
  }

  pause(on) {
    const app = this.app;
    if (on === app.paused) return;
    if (on && this.mode !== 'play') return;
    app.paused = on;
    this.ui.pause(on);
    app.input.clear();
    if (on) app.cam.unlock();
    else app.cam.lock();
  }

  quitToTitle() {
    const app = this.app;
    // Leave 'play'/'cinematic' first, so ending a cutscene below does not hand
    // control (and the mouse lock) back to a game that is closing.
    this.mode = 'title';
    if (this.cine.active) this.cine.skip();
    this.hidePlayer = false;
    this.showOutside = false;
    this.cullY = null;
    app.cam.unlock();
    app.paused = false;
    this.ui.pause(false);
    this.ui.gameover(false);
    this.ui.ending(false);
    app.reviveBody();
    app.timeScale = 1;
    this.ui.hud(false);
    this.ui.boss(null);
    this.newGameReset();
    this.showTitle();
  }

  newGameReset() {
    const app = this.app;
    app.enemies.clear();
    this.spawnCrowd();
    this._timers.length = 0;
    this._restoreNight();
    app.level.van.on = false;
    this.goto(0, { quiet: true, place: true });
    this.mode = 'title';
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  preUpdate(dt, raw) {
    const app = this.app;
    if (this.mode === 'title') {
      const t = performance.now() * 0.00005;
      const r = 40;
      app.cam.setShot(v3(4 + Math.cos(t) * r, 24 + Math.sin(t * 2.3) * 4, 16 + Math.sin(t) * r * 1.1), v3(8, 15, 12));
    }
    // slow-mo after a perfect dodge (on real time)
    if (this._slowmo > 0) {
      this._slowmo -= raw;
      app.timeScale = 0.3;
      if (this._slowmo <= 0) { app.timeScale = 1; this.ui.slowmo(false); }
    }
    this.cine.holdSkip(this._skipHeld, raw);
    this.cine.update(raw);
  }

  update(dt, raw) {
    const app = this.app;
    for (let i = this._timers.length - 1; i >= 0; i--) {
      const t = this._timers[i];
      t.t -= dt;
      if (t.t <= 0) { this._timers.splice(i, 1); t.fn(); }
    }
    this._updateDawn(dt);
    {
      const inside = (app.enemies.player.zone !== 'outside' || app.character.position.x > 6.5 * K && app.character.position.z < 13.45 * K) && !this.showOutside && this.mode !== 'title' ? 1 : 0;
      this.indoor += (inside - this.indoor) * Math.min(1, raw * 3);
    }
    this.slamRing.update(dt, this._slamLook ??= { ...settings.judgement.shock, color: '#ff4a14', crackColor: '#ffb36b' });
    const pos = app.character.position;

    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.group.position.y = p.base + Math.sin(p.t * 2.5) * 0.08;
      p.group.children[1].rotation.z += dt * 1.5;
      if (this.mode === 'play' && this.hp < this.maxHp && p.group.position.distanceTo(_v.set(pos.x, pos.y + 0.7, pos.z)) < 1.1) {
        this.heal(p.amount);
        this._removePickup(p);
      }
    }

    if (this.mode === 'dead') {
      this._dead += raw;
      if (this._dead > 2.2 && !this.ui.gameoverOpen) {
        app.timeScale = 1;
        this.ui.gameover(true);
      }
    }

    if (this.mode === 'play') {
      this.stats.time += dt;
      this.step?.update?.(this, dt);
      if (this.step?.done?.(this)) this.next();
      this._interact();
      // combo decay
      if (this._comboTimer > 0) {
        this._comboTimer -= dt;
        if (this._comboTimer <= 0) { this.combo = 0; this.ui.combo(0); }
      }
      // low health heartbeat
      if (this.hp < 30) {
        this._beat -= raw;
        if (this._beat <= 0) { this._beat = 0.9; app.sound.heartbeat(); }
      }
      this.ui.objectiveText(this._objectiveText());
    }
    this._music(dt);
    this.ui.update(dt, this);
  }

  /**
   * Which cue the score should be on, and how hard.
   *   title · cinematic · explore ⇄ combat (with a few seconds of hold so a
   *   lull in a fight does not drop the drums) · boss · dawn · death
   * Combat intensity is how many shades are actually on you (four is
   * everything), pushed up when you are low on health or deep in a combo.
   */
  _music(dt) {
    const app = this.app;
    const s = app.sound;
    let engaged = 0;
    let near = 0;
    for (const e of app.enemies.enemies) {
      if (!e.alive || e.ai === 'dormant' || e.tag === 'crowd' && !this._near(e, 22)) continue;
      if (this._near(e, 12)) engaged++;
      else if (this._near(e, 25)) near++;
    }
    if (engaged > 0) this._lastFight = 0;
    else this._lastFight = (this._lastFight ?? 99) + dt;
    let cue;
    let intensity = 0;
    if (this.mode === 'title' || this.mode === 'loading') cue = 'title';
    else if (this.mode === 'ending' || this.dawn > 0) cue = 'dawn';
    else if (this.mode === 'dead') cue = 'death';
    else if (this.boss?.alive) {
      cue = 'boss';
      intensity = this.flags.phase2 ? 1 : 0.45;
    } else if (this.mode === 'cinematic') cue = 'cinematic';
    else if (engaged > 0 || this._lastFight < 4) {
      cue = 'combat';
      intensity = Math.min(1, engaged / 4 + (this.hp < 35 ? 0.3 : 0) + Math.min(0.3, this.combo * 0.03));
    } else {
      cue = 'explore';
      intensity = near > 0 ? 0.6 : 0;
    }
    s.cue = cue;
    s.intensity = intensity;
    s.setSpace?.(this.indoor);
  }

  /** Called with the distance the body moved this frame (footsteps). */
  moved(d) {
    this._stepAcc += d;
    if (this._stepAcc > 0.75) {
      this._stepAcc = 0;
      const r = this.app.world.regionAt(this.app.character.position.x, this.app.character.position.z, this.app.character.position.y);
      this.app.sound.step(r?.tag === 'wood' ? 'wood' : r?.tag === 'street' ? 'street' : 'tile');
    }
  }

  _interact() {
    const app = this.app;
    const pos = app.character.position;
    let best = null;
    let bd = Infinity;
    for (const it of this.interactables) {
      if (!(typeof it.enabled === 'function' ? it.enabled() : it.enabled)) continue;
      const p = typeof it.pos === 'function' ? it.pos() : it.pos;
      if (Math.abs(p.y - pos.y) > 1.6) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    this.ui.prompt(best ? (typeof best.prompt === 'function' ? best.prompt() : best.prompt) : null);
    if (app.input.consumeUse() && best) best.onUse(this);
  }

  _near(enemy, r) {
    const p = this.app.character.position;
    const e = enemy.position;
    return Math.abs(p.y - e.y) < 3 && Math.hypot(p.x - e.x, p.z - e.z) < r;
  }

  floorLabel() {
    const p = this.app.character.position;
    if (this.app.enemies.player.zone === 'outside' && (p.z > 13.42 * K || p.x < 6.5 * K)) return '街道';
    const n = Math.floor((p.y - PLINTH) / FH + 0.3) + 1;
    return `${Math.max(1, n)}F`;
  }
}

/* -------------------------------------------------------------------- */
/* dawn look                                                             */
/* -------------------------------------------------------------------- */

const DAWN = {
  'sky.zenith': '#2d4f7c',
  'sky.exposure': 0.95,
  'sky.broadGlow': 0.5,
  'sky.sunGlow': 0.6,
  'sky.stars.brightness': 0,
  'sky.moon.brightness': 0.6,
  'haze.color': '#c98f6a',
  'haze.sunColor': '#ffd7a8',
  'haze.density': 0.0035,
  'environment.sunColor': '#ffd2a6',
  'environment.sunIntensity': 6.5,
  'environment.ambientColor': '#a07a68',
  'environment.ambientIntensity': 0.7,
  'environment.hemiSkyColor': '#ffc79a',
  'environment.hemiGroundColor': '#4a3a30',
  'environment.hemiIntensity': 1.1,
  'environment.rimColor': '#ffd9b0',
  'environment.floorTint': '#8a7062',
  'groundFog.color': '#c2957c',
  'groundFog.litColor': '#ffe2c4',
  'post.temperature': 0.12,
  'post.exposure': 1.1
};

function getPath(path) {
  return path.split('.').reduce((o, k) => o?.[k], settings);
}

function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const o = keys.reduce((o, k) => o?.[k], settings);
  if (o) o[last] = value;
}

function snapshot() {
  const s = {};
  for (const k of Object.keys(DAWN)) s[k] = getPath(k);
  return s;
}

const _ca = new Color();
const _cb = new Color();
function applyLook(from, to, k) {
  for (const key of Object.keys(DAWN)) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'number') setPath(key, a + (b - a) * k);
    else if (typeof a === 'string') {
      _ca.set(a);
      _cb.set(b);
      setPath(key, '#' + _ca.lerp(_cb, k).getHexString());
    }
  }
}

let _cross = null;
function crossTexture() {
  if (_cross) return _cross;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.fillRect(54, 30, 20, 68);
  g.fillRect(30, 54, 68, 20);
  _cross = new CanvasTexture(c);
  _cross.colorSpace = SRGBColorSpace;
  return _cross;
}

export { PLAZA, VAN };
