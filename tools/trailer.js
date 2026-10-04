/**
 * NOT IN MY HOUSE — trailer director.
 *
 * The real game, edited as a trailer. Structure follows the usual
 * story-driven game trailer outline (cold open → world → want → escalation →
 * climax → beat of silence → title → button):
 *
 *   I   冷開場  the lift climbs, the power dies, something walks past the door
 *   II  世界    black rain, the shades, the tower — 「我只想回家。」
 *   III 我家    they are inside; bare hands; grandfather's burning katana
 *   IV  升級    the horde below, they climb, eight floors down, the plaza —
 *               cuts get shorter: slide cut, shadows, the blade storm, 見切
 *   V   高潮    the Mother of the Black Tide; the last blow in slow motion
 *       silence → NOT IN MY HOUSE → dawn → 瀏覽器即玩
 *
 * Continuity: every jump in space happens under an intertitle, a dip to
 * black or a white flash on a hit, never in the open; the score is one
 * continuous cue the director pushes up act by act.
 *
 * Recording happens in the page: the WebGL frame, the cinematic chrome and the
 * WebAudio mix are composited and fed to a MediaRecorder.
 *
 *   const { recordTrailer } = await import('./tools/trailer.js');
 *   await recordTrailer(window.app, (chunkBase64) => …);
 */

const W = 1280;
const H = 720;
const K = 1.5;
const Y8 = 0.45 + 7 * 3.75;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function recordTrailer(app, onChunk, { bitrate = 3_000_000 } = {}) {
  const comp = new Compositor(app);
  const stream = comp.canvas.captureStream(30);
  const sound = app.sound;
  sound.init();
  const dest = sound.ctx.createMediaStreamDestination();
  sound.master.connect(dest);
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160_000 });
  const pending = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) pending.push(e.data.arrayBuffer().then((buf) => onChunk(toBase64(buf))));
  };
  const stopped = new Promise((r) => { rec.onstop = r; });
  comp.black = 1;
  const director = new Director(app, comp);
  // Every effect once, unrecorded, so no shader compiles mid-take.
  await director.warmup();
  rec.start(1000);
  try {
    await director.run();
  } finally {
    rec.stop();
    await stopped;
    await Promise.all(pending);
    comp.dispose();
    sound.override = null;
    sound.calmOverride = null;
  }
  return mime;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* -------------------------------------------------------------------- */
/* the edit                                                              */
/* -------------------------------------------------------------------- */

class Director {
  constructor(app, comp) {
    this.app = app;
    this.g = app.game;
    this.comp = comp;
    this.pilot = new Autopilot(app);
    const g = this.g;
    // Scenes can keep only some of a cutscene's shots, and play them faster.
    const original = g.cinematic.bind(g);
    g.cinematic = (shots, done, opts) => {
      const pick = this.pick;
      this.pick = null;
      if (pick) {
        const s = pick.scale ?? 1;
        shots = shots
          .filter((_, i) => pick.shots.includes(i))
          .map((shot) => ({
            ...shot,
            dur: shot.dur * s,
            subAt: shot.subAt !== undefined ? shot.subAt * s : undefined,
            subs: shot.subs?.map(([t, x]) => [t * s, x])
          }));
      }
      original(shots, done, opts);
    };
    g.hurtPlayer = () => {}; // the hero of a trailer does not die
    g.next = () => {}; // the edit decides what comes next, not the story
  }

  /* ---- tools ------------------------------------------------------ */

  idx(id) {
    return this.g.steps.findIndex((s) => s.id === id);
  }

  async cine() {
    const g = this.g;
    for (let i = 0; i < 30 && !g.cine.active; i++) await wait(50);
    while (g.cine.active) await wait(40);
  }

  music(level, calm = false) {
    this.app.sound.override = level;
    this.app.sound.calmOverride = calm;
  }

  clearEnemies(filter = null) {
    this.app.enemies.clear(filter);
    this.g._timers.length = 0;
  }

  kill(enemy, force = { impulse: 6, lift: 3.5, spin: 1.5, slices: true }) {
    if (enemy?.alive) this.g.damageEnemy(enemy, 999, Math.sin(this.app.character.facing), Math.cos(this.app.character.facing), force);
  }

  place(x, y, z, faceTo = null) {
    const app = this.app;
    const p = app.character.position;
    p.set(x, y, z);
    app.controller.velocity.set(0, 0);
    if (faceTo) {
      const yaw = Math.atan2(faceTo.x - x, faceTo.z - z);
      window.settings.character.facing = yaw;
      app.character.setFacing(yaw);
    }
    app.cam.snap(p);
  }

  /** Stand shades up around the hero, awake and coming. */
  surround(kind, n, rMin, rMax, opts = {}) {
    const app = this.app;
    const p = app.character.position;
    const out = [];
    const spread = opts.spread ?? Math.PI * 2;
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = (opts.arc ?? 0) + spread * ((i + 0.2 + Math.random() * 0.6) / n) - spread / 2;
        const r = rMin + Math.random() * (rMax - rMin);
        const x = p.x + Math.sin(a) * r;
        const z = p.z + Math.cos(a) * r;
        const h = app.world.heightAt(x, z, p.y + 0.4);
        if (Math.abs(h - p.y) > 0.4 || app.world.blocked(x, z, 0.4, h)) continue;
        // in the same room as the hero, in plain sight of the lens
        if (!app.world.sight(p.x, p.y + 1.2, p.z, x, h + 1.2, z)) continue;
        out.push(this.g.spawn(kind, { x, z, y: p.y, yaw: Math.atan2(p.x - x, p.z - z), awake: opts.awake !== false }, 'tr'));
        break;
      }
    }
    return out;
  }

  sub(text, ms = 2600) {
    this.g.ui.subtitle(text, ms / 1000);
  }

  /** A card on black. Anything passed in `during` happens unseen behind it. */
  async card(text, ms = 2200, during = null) {
    this.g.ui.subtitle('');
    this.comp.inter = { text, start: performance.now(), dur: ms };
    await this.comp.fadeBlack(1, 260);
    if (during) await during();
    await wait(Math.max(0, ms - 700));
    this.comp.inter = null;
    await this.comp.fadeBlack(0, 380);
  }

  /** Dip to black and back, doing `fn` in the dark. */
  async dip(fn, hold = 140) {
    this.g.ui.subtitle('');
    await this.comp.fadeBlack(1, 230);
    await fn();
    await wait(hold);
    await this.comp.fadeBlack(0, 260);
  }

  /** A white hit-frame to cut on. */
  async flash(fn) {
    this.comp.flashAt = performance.now();
    await wait(70);
    await fn();
    await wait(90);
  }

  /** Run every effect once behind black: a first use compiles shaders and stalls. */
  async warmup() {
    const { app, g } = this;
    g.newGame({ intro: false });
    await wait(300);
    g.giveSword();
    this.place(-8, 0, 20);
    const foes = this.surround('shade', 5, 3, 6, { awake: false });
    await wait(400);
    this.kill(foes[0]);
    this.kill(foes[1], { impulse: 5, lift: 3, spin: 1 });
    if (foes[2]) app.judgement.cast(foes[2]);
    if (foes[3] && foes[4]) app.shadows.summon([foes[3], foes[4]]);
    app.input.press('slashHit');
    await wait(2500);
    const more = this.surround('shade', 2, 6, 8, { awake: false });
    g.spirit = 100;
    app._toggleFlight();
    await wait(900);
    for (const e of more) app.blades.mark(e);
    await wait(900);
    app._loose();
    await wait(1500);
    if (app.character.flight?.active) app._toggleFlight();
    await wait(800);
    app.shadows.dismiss({ immediate: true });
    app.judgement.dismiss({ immediate: true });
    app.blades.dismiss({ immediate: true });
    this.clearEnemies();
    app.blood.clear?.();
    g.quitToTitle();
    await wait(300);
  }

  /* ---- the cut ---------------------------------------------------- */

  async run() {
    const { app, g, comp } = this;
    g.ui.setQuality(false);
    app.renderer.targetPixelRatio = () => 1;
    app.renderer.handleResize();
    try { localStorage.removeItem('nimh.save.v1'); } catch { /* ignore */ }
    const steps = g.steps;
    this.t0 = performance.now();

    /* I. COLD OPEN — the lift, the power, the thing outside the door */
    this.music(0, true);
    this.pick = { shots: [4, 5, 6], scale: 0.85 };
    g.newGame({ intro: true });
    await wait(100);
    await comp.fadeBlack(0, 900);
    await this.cine();
    g.ui.subtitle('');

    /* II. THE WORLD — black rain, the shades, the tower */
    await this.card('那一夜，城市下了黑雨。', 2400, async () => {
      this.music(0.05, false);
      this.pick = { shots: [1, 2, 3], scale: 0.72 };
      steps[0].prologue();
      await wait(50);
    });
    await this.cine();
    g.ui.subtitle('');

    /* III. HOME — bare hands, then grandfather's katana */
    await this.card('我只想回家。', 2000, async () => {
      g.ui.titleCard(false);
      this.clearEnemies((e) => e.tag !== 'crowd');
      g.flags.pried = true;
      app.level.lift.target = 1;
      app.level.lift.open = 1;
      this.pick = { shots: [1, 2], scale: 0.85 };
      g.goto(this.idx('sword'), { place: true });
    });
    await this.cine();
    this.music(0.35);
    // no sword yet: kicks
    await this.dip(() => {
      this.clearEnemies((e) => e.tag !== 'crowd');
      this.place(12.4, Y8, 12.2);
      this.surround('shade', 2, 2.2, 3.0, { arc: 0.3, spread: 1.8 });
      this.pilot.frameNow();
    });
    this.sub('沒有刀——就用腳。', 2800);
    await this.pilot.run(4200, { moves: ['kick'] });
    // the katana
    await this.dip(() => {
      this.clearEnemies((e) => e.tag !== 'crowd');
      this.place(4.0 * K + 0.3, Y8, 4.75 * K, { x: 0, z: 4.75 * K });
      g.interactables.find((it) => /爺爺的刀/.test(typeof it.prompt === 'function' ? it.prompt() : it.prompt))?.onUse(g);
    });
    await this.cine();
    // the burning blade
    this.music(0.6);
    await this.flash(() => {
      this.place(12.4, Y8, 12.6);
      this.surround('shade', 3, 2.0, 3.4, { arc: Math.PI * 0.9, spread: 2.4 });
      this.pilot.frameNow();
    });
    this.sub('這是<em>我家</em>。', 2400);
    // keep three of them on the blade for the whole shot
    let last = 0;
    const refill = () => {
      const alive = app.enemies.enemies.filter((e) => e.alive && e.tag === 'tr').length;
      if (alive < 3 && performance.now() - last > 700) {
        last = performance.now();
        this.surround('shade', 1, 2.6, 3.6, { arc: Math.random() * 6.28, spread: 2 });
      }
    };
    await this.pilot.run(6000, { moves: ['slashHit', 'slashHit', 'kick', 'slashHit'], refill });
    // judgement on a brute
    await this.flash(() => {
      this.clearEnemies((e) => e.alive && e.tag === 'tr');
      this.place(11.4, Y8, 14.4);
      const [brute] = this.surround('brute', 1, 3.6, 4.2, { arc: Math.PI * 0.85, spread: 0.3, awake: false });
      this.brute = brute;
      this.pilot.frameNow(brute, 0.5);
    });
    await wait(500);
    if (this.brute?.alive && app.judgement.cast(this.brute)) this.sub('<em>天罰。</em>', 2000);
    await this.pilot.watch(this.brute, 2600);

    /* IV. ESCALATION — they keep coming */
    await this.card('它們，不會停。', 1900, async () => {
      this.clearEnemies((e) => e.tag !== 'crowd');
      this.place(1.0, Y8, 12.6, { x: -5, z: 12.6 });
      this.music(0.7);
      this.pick = { shots: [1], scale: 1 };
      g.goto(this.idx('climbers'), {});
    });
    await this.cine();
    this.clearEnemies((e) => e.tag !== 'crowd');
    // they come over the railing
    await this.dip(() => {
      this.place(1.2, Y8, 12.6, { x: -2, z: 12.6 });
      for (const [z, d] of [[11.4, 0], [13.6, 500]]) {
        setTimeout(() => this.g.spawn('shade', { x: 0.75, z, y: Y8, yaw: Math.PI / 2, spawn: 'climb', from: { clone: () => ({ x: -0.7, y: Y8 - 1.9, z }) } }, 'tr'), d);
      }
      const cam = app.cam;
      cam.yaw = Math.PI * 0.62;
      cam.pitch = 0.22;
      cam.snap(app.character.position);
    }, 60);
    this.sub('……它們聽到了。', 2200);
    await wait(2300);
    await this.pilot.run(3600, { moves: ['slashHit', 'kick', 'slashHit'] });
    // the stairwell
    await this.dip(() => {
      this.clearEnemies((e) => e.tag !== 'crowd');
      this.pick = { shots: [2], scale: 0.65 };
      g.goto(this.idx('stairs'), { place: true });
    }, 60);
    await this.cine();
    await this.flash(() => {
      this.clearEnemies((e) => e.tag !== 'crowd' && e.tag !== 'stairs');
      this.place(15.4, 0.45 + 5 * 3.75 + 1.75, 18.6);
      for (const e of app.enemies.enemies) if (e.tag === 'stairs' && Math.abs(e.position.y - app.character.position.y) < 1.5) e.wake();
      this.pilot.frameNow();
    });
    this.sub('八層樓，一層一層殺下去。', 2600);
    await this.pilot.run(3600, { moves: ['kick', 'slashHit', 'slashHit'] });
    // out
    await this.dip(() => {
      this.clearEnemies((e) => e.tag !== 'crowd');
      this.pick = { shots: [1], scale: 0.75 };
      g.goto(this.idx('exit'), { place: true });
    }, 60);
    await this.cine();

    /* the montage: shorter and shorter */
    this.music(1);
    await this.card('殺出一條血路。', 1500, async () => {
      g.goto(this.idx('plaza'), {});
      g.flags.wave2 = true;
      this.clearEnemies();
      g.spirit = 100;
    });
    // slide cut
    await this.flash(() => {
      this.place(-8, 0, 18);
      const [e] = this.surround('shade', 1, 6.0, 6.5, { arc: Math.PI * 0.75, spread: 0.2, awake: false });
      this.pilot.face(e);
      this.pilot.frameNow(e, 0.7);
    });
    await wait(300);
    app.input.press('crouchSlash');
    await wait(1700);
    // shadows
    await this.flash(() => {
      this.clearEnemies((e) => e.tag === 'tr');
      this.place(-12, 0, 26);
      this.pair = this.surround('shade', 2, 4.5, 5.5, { arc: 0, spread: 1.4, awake: false });
      this.pilot.frameNow(this.pair[0], -0.4);
    });
    if (this.pair.length === 2) { app.shadows.summon(this.pair); this.sub('影分身。', 1800); }
    await wait(2600);
    // blade storm
    await this.flash(() => {
      this.clearEnemies((e) => e.tag === 'tr');
      app.shadows.dismiss({ immediate: true });
      this.place(-10, 0, 34);
      this.storm = this.surround('shade', 4, 6, 10, { arc: Math.PI, spread: 2.4, awake: false });
      this.surround('runner', 1, 6, 8, { arc: Math.PI, spread: 0.5, awake: false }).forEach((e) => this.storm.push(e));
      this.pilot.frameNow(this.storm[0], 0.2);
      app.cam.wantDistance = 6.5;
    });
    app._toggleFlight();
    await wait(1200);
    for (const e of this.storm) app.blades.mark(e);
    this.sub('萬劍。', 1800);
    await wait(1700);
    app._loose();
    await wait(2000);
    if (app.character.flight?.active) app._toggleFlight();
    await wait(600);
    // 見切
    await this.flash(() => {
      this.clearEnemies((e) => e.tag === 'tr');
      app.cam.wantDistance = 4.4;
      this.place(-16, 0, 20);
      const [b] = this.surround('brute', 1, 2.0, 2.3, { arc: Math.PI * 0.6, spread: 0.3 });
      this.pilot.frameNow(b, 0.6);
    });
    await this.pilot.run(3600, { moves: ['slashHit', 'slashHit', 'kick'], perfect: true });
    // a last flurry
    await this.flash(() => {
      this.clearEnemies((e) => e.tag === 'tr');
      this.place(-6, 0, 30);
      this.surround('runner', 2, 2.5, 3.5, { arc: Math.PI, spread: 2 });
      this.surround('shade', 2, 2.5, 3.5, { arc: 0, spread: 2 });
      this.pilot.frameNow();
    });
    await this.pilot.run(3800, { moves: ['slashHit', 'kick', 'slashHit', 'slashHit'] });

    /* V. CLIMAX — the Mother of the Black Tide */
    await this.dip(() => {
      this.clearEnemies();
      g.flags.bossSeen = false;
      this.pick = { shots: [0, 1, 2], scale: 0.8 };
      g.goto(this.idx('boss'), { place: true });
    }, 60);
    await this.cine();
    this.sub('殺了它，<em>天就會亮</em>。', 2600);
    await this.pilot.run(5200, { boss: true, perfect: true, moves: ['slashHit', 'slashHit', 'kick', 'slashHit', 'crouchSlash'] });
    // the last blow, slowly
    app.sound.riser(2.6);
    if (g.boss?.alive) g.boss.hp = 1;
    await this.pilot.run(2600, { boss: true, moves: ['slashHit'] });
    if (g.boss?.alive) this.kill(g.boss);
    await wait(1500);

    /* silence, then the title */
    app.sound.duck(0, 0.15);
    await comp.fadeBlack(1, 120);
    this.music(0, true);
    await wait(900);
    const card = document.getElementById('titleCard');
    card.querySelector('p').innerHTML = '這是我家。滾出去。';
    card.style.transition = 'none';
    g.ui.titleCard(true);
    app.sound.duck(1, 0.05);
    app.sound.boom();
    await wait(3600);
    g.ui.titleCard(false);
    card.style.transition = '';

    /* BUTTON — dawn */
    await wait(700);
    this.clearEnemies();
    g.goto(this.idx('dawn'), {});
    g.dawn = 0.995;
    await wait(300);
    this.pick = { shots: [1, 2], scale: 0.85 };
    g.interactables.find((it) => /救援車/.test(typeof it.prompt === 'function' ? it.prompt() : it.prompt))?.onUse(g);
    await wait(60);
    await comp.fadeBlack(0, 800);
    await this.cine();

    /* end card */
    card.querySelector('p').innerHTML = '瀏覽器即玩<br><small>bcjack0125.github.io/NOT-IN-MY-HOUSE</small>';
    g.ui.ending(false);
    await comp.fadeBlack(1, 500);
    g.ui.titleCard(true);
    app.sound.sting();
    await wait(5200);
    await comp.fadeTitle(800);
    console.log(`[autopilot] frames ${comp.frames} in ${((performance.now() - this.t0) / 1000).toFixed(1)} s`);
  }
}

/* -------------------------------------------------------------------- */
/* the hands                                                             */
/* -------------------------------------------------------------------- */

/**
 * Plays the fights. Walks at its target, turns to face it squarely before
 * every swing (so each move locks on and lands), cycles through the moves it
 * was given, and dodges into a perfect 見切 when asked.
 */
class Autopilot {
  constructor(app) {
    this.app = app;
    this.side = 1;
  }

  nearest() {
    const p = this.app.character.position;
    let best = null;
    let bd = Infinity;
    for (const e of this.app.enemies.enemies) {
      if (!e.alive || e.spawnFx || Math.abs(e.position.y - p.y) > 1.6) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Turn the body to face `e` exactly. */
  face(e) {
    if (!e) return;
    const p = this.app.character.position;
    const yaw = Math.atan2(e.position.x - p.x, e.position.z - p.z);
    window.settings.character.facing = yaw;
    this.app.character.setFacing(yaw);
  }

  /** Where the lens wants to be: behind and to one side of the hero, looking at the fight. */
  wantYaw(e, side = this.side * 0.55) {
    const p = this.app.character.position;
    const t = e ?? this.nearest();
    if (!t) return this.app.cam.yaw;
    return Math.atan2(p.x - t.position.x, p.z - t.position.z) + side;
  }

  frameNow(e = null, side = null) {
    const cam = this.app.cam;
    cam.yaw = this.wantYaw(e, side ?? this.side * 0.55);
    cam.pitch = 0.3;
    cam.snap(this.app.character.position);
  }

  /** Keep the lens on something without fighting (a cast landing). */
  watch(e, ms) {
    const cam = this.app.cam;
    return new Promise((resolve) => {
      const end = performance.now() + ms;
      const tick = () => {
        if (performance.now() >= end) return resolve();
        if (e?.alive) cam.yaw += angle(this.wantYaw(e, 0.45) - cam.yaw) * 0.08;
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  run(ms, { moves = ['slashHit', 'kick'], boss = false, perfect = false, refill = null } = {}) {
    const app = this.app;
    const before = { damage: app.game.stats.damage, kills: app.game.stats.kills };
    let swings = 0;
    const input = app.input;
    const cam = app.cam;
    cam.wantDistance = boss ? 6.2 : 4.4;
    let cool = 0;
    let turn = 0;
    let last = performance.now();
    const dodged = new Set();
    // the moves step in on their own (motion warping), so swing from their lock-on range
    const ranges = { kick: 2.7, slashHit: 3.6, crouchSlash: 7 };
    return new Promise((resolve) => {
      const end = performance.now() + ms;
      const tick = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (now >= end || app.game.mode !== 'play') {
          input.stick.x = input.stick.y = 0;
          input.stick.run = false;
          console.log(`[autopilot] ${moves.join('/')}: ${swings} swings, ${app.game.stats.damage - before.damage} damage, ${app.game.stats.kills - before.kills} kills`);
          resolve();
          return;
        }
        if (app.character.flight?.active) return requestAnimationFrame(tick);
        refill?.();
        const p = app.character.position;
        const e = boss && app.game.boss?.alive ? app.game.boss : this.nearest();
        if (!e) {
          input.stick.x = input.stick.y = 0;
          return requestAnimationFrame(tick);
        }
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        const d = Math.hypot(dx, dz) - e.radius;

        // lens: three-quarter view, swapping sides now and then
        cam.yaw += angle(this.wantYaw(e) - cam.yaw) * Math.min(1, dt * 4);
        cam.pitch += (0.28 - cam.pitch) * Math.min(1, dt * 3);

        const busy = app.character.attacks.some((m) => m.locked && !m.cancelable) || app.controller.dodging;
        let move = moves[turn % moves.length];
        if (move === 'crouchSlash' && d < 3) { turn++; move = moves[turn % moves.length]; }
        const reach = (ranges[move] ?? 2.5) + (boss ? 1.2 : 0);

        // 見切: dash out just before an enemy's blow lands
        if (perfect && !app.controller.dodging) {
          for (const o of app.enemies.enemies) {
            if (!o.alive || o.ai !== 'strike' || dodged.has(o) || !o.attackAction) continue;
            const phase = o.attackAction.time / o.attackAction.getClip().duration;
            const od = Math.hypot(o.position.x - p.x, o.position.z - p.z);
            if (phase > o.attack.hitAt - 0.14 && od < (o.attack.aoe ?? o.attack.reach) + 0.6) {
              dodged.add(o);
              setTimeout(() => dodged.delete(o), 1500);
              this.stick(-dx, -dz, 1);
              input.press('dodge');
              this.side *= -1;
            }
          }
        }

        if (busy) {
          input.stick.x = input.stick.y = 0;
        } else if (d > reach) {
          // close in
          this.stick(dx, dz, 1);
          input.stick.run = d > 3.5;
        } else {
          input.stick.x = input.stick.y = 0;
          input.stick.run = false;
          cool -= dt;
          if (cool <= 0) {
            // squarely at it, then the move: the swing locks on and lands
            this.face(e);
            input.press(move);
            swings++;
            // the next press waits only for the cancel window: a real combo
            cool = move === 'crouchSlash' ? 0.5 : 0.06;
            turn++;
            if (turn % 5 === 0) this.side *= -1;
          }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /** Push the stick toward a world direction (whatever the camera is doing). */
  stick(wx, wz, k) {
    const l = Math.hypot(wx, wz) || 1;
    wx /= l;
    wz /= l;
    const az = this.app.cam.azimuth;
    const s = Math.sin(az);
    const c = Math.cos(az);
    this.app.input.stick.x = (wx * c - wz * s) * k;
    this.app.input.stick.y = (-wx * s - wz * c) * k;
  }
}

function angle(a) {
  return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/* -------------------------------------------------------------------- */
/* the frame                                                             */
/* -------------------------------------------------------------------- */

/** WebGL frame + the cinematic chrome + the editor's cards, dips and flashes. */
class Compositor {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.black = 0;
    this.titleFade = 1;
    this.inter = null;
    this.flashAt = -1e9;
    this.el = {
      fade: document.getElementById('fade'),
      title: document.getElementById('titleCard'),
      chapter: document.getElementById('chapterCard'),
      sub: document.getElementById('subtitle'),
      slowmo: document.getElementById('slowmo')
    };
    const post = app.post;
    this._render = post.render.bind(post);
    post.render = () => {
      this._render();
      this.draw();
    };
  }

  dispose() {
    this.app.post.render = this._render;
  }

  fadeBlack(to, ms) {
    const from = this.black;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        this.black = from + (to - from) * k * k * (3 - 2 * k);
        if (k < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  fadeTitle(ms) {
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        this.titleFade = 1 - k;
        if (k < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  draw() {
    this.frames = (this.frames ?? 0) + 1;
    const c = this.ctx;
    c.globalAlpha = 1;
    c.drawImage(this.app.renderer.gl.domElement, 0, 0, W, H);
    const op = (el) => parseFloat(getComputedStyle(el).opacity) || 0;

    if (this.el.slowmo.classList.contains('on')) {
      const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
      g.addColorStop(0, 'rgba(40,120,255,0)');
      g.addColorStop(1, 'rgba(40,120,255,0.3)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    const bar = Math.round(H * 0.11);
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, bar);
    c.fillRect(0, H - bar, W, bar);

    // chapter card
    const ch = this.el.chapter;
    const cho = ch.classList.contains('on') ? op(ch) : 0;
    if (cho > 0.01) {
      c.save();
      c.globalAlpha = cho;
      c.textAlign = 'center';
      c.fillStyle = '#ffb36b';
      c.font = '600 18px "Noto Serif TC", serif';
      c.fillText(spaced(ch.querySelector('small').textContent), W / 2, H * 0.29);
      c.shadowColor = 'rgba(255,80,20,0.7)';
      c.shadowBlur = 24;
      c.fillStyle = '#fff1e6';
      c.font = '900 64px "Noto Serif TC", serif';
      c.fillText(ch.querySelector('b').textContent, W / 2, H * 0.29 + 72);
      c.restore();
    }

    // subtitle
    const sub = this.el.sub;
    const so = sub.classList.contains('on') ? op(sub) : 0;
    if (so > 0.01 && sub.textContent.trim()) {
      c.save();
      c.globalAlpha = so;
      c.font = '700 30px "Noto Serif TC", serif';
      c.textBaseline = 'middle';
      const runs = parseRuns(sub.innerHTML);
      const total = runs.reduce((s, r) => s + c.measureText(r.text).width, 0);
      let x = W / 2 - total / 2;
      c.shadowColor = '#000';
      c.shadowBlur = 10;
      for (const r of runs) {
        c.fillStyle = r.em ? '#ffb36b' : '#f6ece2';
        c.fillText(r.text, x, H - bar - 46);
        x += c.measureText(r.text).width;
      }
      c.restore();
    }

    // the game's own fade (cutscenes) and the editor's black
    const fd = this.el.fade;
    const fo = op(fd);
    if (fo > 0.01) {
      c.fillStyle = fd.classList.contains('white') ? `rgba(255,246,234,${fo})` : `rgba(0,0,0,${fo})`;
      c.fillRect(0, 0, W, H);
    }
    if (this.black > 0.001) {
      c.fillStyle = `rgba(0,0,0,${this.black})`;
      c.fillRect(0, 0, W, H);
    }

    // intertitle
    if (this.inter) {
      const t = (performance.now() - this.inter.start) / this.inter.dur;
      const a = Math.min(1, t / 0.18) * Math.min(1, (1 - t) / 0.22);
      if (a > 0.01) {
        c.save();
        c.globalAlpha = Math.max(0, a);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#f6ece2';
        c.font = '700 44px "Noto Serif TC", serif';
        c.shadowColor = 'rgba(255,90,30,0.35)';
        c.shadowBlur = 18;
        c.fillText(this.inter.text, W / 2, H / 2);
        c.shadowBlur = 0;
        const w = 60 + 140 * Math.min(1, t * 2);
        c.fillStyle = 'rgba(255,90,30,0.8)';
        c.fillRect(W / 2 - w / 2, H / 2 + 42, w, 2);
        c.restore();
      }
    }

    // title card
    const tc = this.el.title;
    const to = op(tc) * this.titleFade;
    if (to > 0.01) {
      c.save();
      c.globalAlpha = to;
      c.textAlign = 'center';
      c.shadowColor = 'rgba(255,90,30,0.75)';
      c.shadowBlur = 30;
      c.fillStyle = '#fff3e6';
      c.font = '700 108px Oswald, sans-serif';
      c.fillText('NOT IN', W / 2, H * 0.4);
      c.fillText('MY HOUSE', W / 2, H * 0.4 + 104);
      c.shadowBlur = 0;
      const lines = tc.querySelector('p').innerText.split('\n').filter(Boolean);
      c.font = '700 28px "Noto Serif TC", serif';
      c.fillStyle = '#f4dcc8';
      c.fillText(spaced(lines[0] ?? ''), W / 2, H * 0.4 + 172);
      if (lines[1]) {
        c.font = '500 20px Oswald, sans-serif';
        c.fillStyle = '#ffb36b';
        c.fillText(lines[1], W / 2, H * 0.4 + 212);
      }
      c.restore();
    }

    // hit flash
    const f = (performance.now() - this.flashAt) / 220;
    if (f >= 0 && f < 1) {
      c.fillStyle = `rgba(255,248,236,${(1 - f) * (1 - f) * 0.95})`;
      c.fillRect(0, 0, W, H);
    }
  }
}

function spaced(text) {
  return [...text].join(' ');
}

function parseRuns(html) {
  const runs = [];
  const re = /<em>(.*?)<\/em>/g;
  let i = 0;
  let m;
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  while ((m = re.exec(html))) {
    if (m.index > i) runs.push({ text: strip(html.slice(i, m.index)), em: false });
    runs.push({ text: strip(m[1]), em: true });
    i = m.index + m[0].length;
  }
  if (i < html.length) runs.push({ text: strip(html.slice(i)), em: false });
  return runs.filter((r) => r.text);
}
export { Autopilot };
