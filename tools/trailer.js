/**
 * NOT IN MY HOUSE — trailer director.
 *
 * Plays the real game as a ~2:40 trailer: the prologue, each chapter's
 * opening (selected shots), and autopiloted fights in between — kicks in the
 * lobby, the burning katana at home, Judgement, Shadows, the Blade Storm in
 * the plaza, perfect dodges against the Mother of the Black Tide, the dawn.
 *
 * Recording is done in the page: the WebGL frame, the cinematic chrome
 * (letterbox, subtitles, chapter and title cards, fades) and the WebAudio mix
 * are composited and fed to a MediaRecorder, so sound and picture stay in sync.
 *
 *   const { recordTrailer } = await import('./tools/trailer.js');
 *   await recordTrailer(window.app, (chunkBase64) => …);
 */

const W = 1280;
const H = 720;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function recordTrailer(app, onChunk, { bitrate = 2_600_000 } = {}) {
  const comp = new Compositor(app);
  const stream = comp.canvas.captureStream(30);
  const sound = app.sound;
  sound.init();
  const dest = sound.ctx.createMediaStreamDestination();
  sound.master.connect(dest);
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 });
  const pending = [];
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    pending.push(e.data.arrayBuffer().then((buf) => onChunk(toBase64(buf))));
  };
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start(1000);
  try {
    await new Director(app).run();
  } finally {
    rec.stop();
    await stopped;
    await Promise.all(pending);
    comp.dispose();
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
/* the cut                                                               */
/* -------------------------------------------------------------------- */

class Director {
  constructor(app) {
    this.app = app;
    this.g = app.game;
    this.pilot = new Autopilot(app);
    // Let a scene pick which of a cinematic's shots to keep.
    const g = this.g;
    const original = g.cinematic.bind(g);
    g.cinematic = (shots, done, opts) => {
      const pick = this.pick;
      this.pick = null;
      original(pick ? shots.filter((_, i) => pick.includes(i)) : shots, done, opts);
    };
    g.hurtPlayer = () => {}; // the trailer's hero does not die
  }

  idx(id) {
    return this.g.steps.findIndex((s) => s.id === id);
  }

  /** Resolve once the cinematic running now (or about to start) has ended. */
  async cine() {
    const g = this.g;
    for (let i = 0; i < 20 && !g.cine.active; i++) await wait(50);
    while (g.cine.active) await wait(50);
    await wait(150);
  }

  kill(tag) {
    for (const e of this.app.enemies.enemies) if (e.alive && (!tag || e.tag === tag)) this.g.damageEnemy(e, 999, 1, 0, { impulse: 4, lift: 3, spin: 1 });
  }

  clear(filter) {
    this.app.enemies.clear(filter);
  }

  tag(text, ms = 2600) {
    this.g.ui.subtitle(text, ms / 1000);
  }

  tp(x, y, z, yaw = null) {
    const p = this.app.character.position;
    p.set(x, y, z);
    if (yaw !== null) this.app.cam.yaw = yaw;
    this.app.cam.snap(p);
  }

  async fight(ms, opts = {}) {
    await this.pilot.run(ms, opts);
  }

  async run() {
    const { app, g } = this;
    const K = 1.5;
    const y8 = 0.45 + 7 * 3.75;
    g.ui.setQuality(false);
    app.renderer.targetPixelRatio = () => 1;
    app.renderer.handleResize();
    localStorage.removeItem('nimh.save.v1');

    /* 1. cold open: the prologue, without its title card */
    this.pick = [0, 1, 2, 3, 5, 6];
    g.newGame({ intro: true });
    await this.cine();

    /* 2. no sword yet: kicks in the lobby */
    app.level.lift.target = 1;
    g.flags.pried = true;
    await wait(300);
    g.wakeTag('lift');
    this.tag('沒有刀——就用腳。', 3000);
    await this.fight(5000);
    this.kill('lift');

    /* 3. home: the door, the living room, the thing on the floor */
    this.pick = [1, 2];
    g.goto(this.idx('sword'), { place: true });
    await this.cine();
    this.tag('這是我家。', 2500);
    await this.fight(3500);

    /* 4. grandfather's katana */
    this.kill('home1');
    this.tp(4.0 * K + 0.3, y8, 4.75 * K, Math.PI / 2);
    // face into the bedroom so the close-up has room behind the lens
    window.settings.character.facing = -Math.PI / 2;
    app.character.setFacing(-Math.PI / 2);
    await wait(200);
    g.interactables.find((it) => /爺爺的刀/.test(typeof it.prompt === 'function' ? it.prompt() : it.prompt))?.onUse(g);
    await this.cine();

    /* 5. the burning blade, and Judgement */
    await wait(300);
    if (g.step.id !== 'clear') g.goto(this.idx('clear'), {});
    this.tp(8.2 * K, y8, 7.4 * K, Math.PI);
    g.spirit = 100;
    await wait(3000);
    this.tag('<em>滾出去。</em>', 2500);
    await this.fight(5500);
    const brute = app.enemies.enemies.find((e) => e.alive && e.kind === 'brute');
    if (brute) { app.judgement.cast(brute); g.ui.damageNumber(brute.position.clone().setY(brute.position.y + 3), '天罰', 'word'); }
    await this.fight(3500);
    this.kill('home1');
    this.kill('home2');

    /* 6. the balcony: the plaza below, and they climb */
    g.goto(this.idx('balcony'), {});
    this.tp(1.0, y8, 12.0, Math.PI / 2);
    await this.cine();
    await this.fight(4500);
    this.kill('climb');
    await wait(300);

    /* 7. the stairwell */
    g._timers.length = 0;
    this.kill('climb');
    this.pick = [2, 3];
    g.goto(this.idx('stairs'), { place: true });
    await this.cine();
    this.tp(15.6, 0.45 + 5 * 3.75 + 1.875, 18.4, Math.PI * 1.5);
    g.wakeTag('stairs');
    this.tag('一層，一層，殺下去。', 2800);
    await this.fight(4500);

    /* 8. out into the plaza */
    this.kill('stairs');
    this.pick = [1, 2];
    g.goto(this.idx('exit'), { place: true });
    await this.cine();
    g.goto(this.idx('plaza'), {});
    this.tp(-5, 0, 13, Math.PI * 0.35);
    for (const e of app.enemies.enemies) if (e.tag === 'crowd' && Math.hypot(e.position.x + 5, e.position.z - 13) < 16) e.wake();
    g.spirit = 100;
    await this.fight(4500);
    // Shadows
    const two = this.pilot.nearest(2);
    if (two.length === 2) { app.shadows.summon(two); this.tag('影分身。', 2200); }
    await this.fight(4000);
    // Blade storm
    g.spirit = 100;
    app._toggleFlight();
    await wait(1600);
    for (const e of this.pilot.nearest(5, 30, true)) app.blades.mark(e);
    this.tag('萬劍。', 2400);
    await wait(2600);
    app._loose();
    await wait(2600);
    if (app.character.flight?.active) app._toggleFlight();
    await this.fight(2000);

    /* 9. the Mother of the Black Tide */
    g.flags.wave2 = true;
    g.flags.wave2Ready = false;
    g._timers.length = 0;
    this.kill('crowd');
    this.kill('wave2');
    await wait(400);
    g.goto(this.idx('boss'), { place: true });
    await this.cine();
    this.tag('殺了它，<em>天就會亮</em>。', 2800);
    await this.fight(7500, { dodgeEager: true, boss: true });
    if (g.boss?.alive) g.boss.hp = 1;
    await this.fight(2000, { boss: true });
    this.kill('boss');

    /* 10. dawn, and home */
    await wait(2200);
    for (const e of app.enemies.enemies) if (e.alive) e.retire();
    await wait(1600);
    this.pick = [1, 2, 3];
    g.interactables.find((it) => /救援車/.test(typeof it.prompt === 'function' ? it.prompt() : it.prompt))?.onUse(g);
    await this.cine();

    /* 11. end card */
    g.ui.ending(false);
    const card = document.getElementById('titleCard');
    card.querySelector('p').innerHTML = '瀏覽器即玩<br><small>bcjack0125.github.io/NOT-IN-MY-HOUSE</small>';
    g.ui.fade(true);
    g.ui.titleCard(true);
    app.sound.sting();
    await wait(6500);
  }
}

/* -------------------------------------------------------------------- */
/* the hands                                                             */
/* -------------------------------------------------------------------- */

/** Plays the fight: walks at the nearest shade, swings, dodges the tells. */
class Autopilot {
  constructor(app) {
    this.app = app;
  }

  nearest(n = 1, range = 18, anyHeight = false) {
    const p = this.app.character.position;
    return this.app.enemies.enemies
      .filter((e) => e.alive && !e.spawnFx && (anyHeight || Math.abs(e.position.y - p.y) < 1.6))
      .map((e) => [e, Math.hypot(e.position.x - p.x, e.position.z - p.z)])
      .filter(([, d]) => d < range)
      .sort((a, b) => a[1] - b[1])
      .slice(0, n)
      .map(([e]) => e);
  }

  run(ms, { dodgeEager = false, boss = false } = {}) {
    const app = this.app;
    const input = app.input;
    const cam = app.cam;
    cam.wantDistance = boss ? 6 : 4.2;
    let cool = 0;
    let last = performance.now();
    const dodged = new Set();
    return new Promise((resolve) => {
      const end = performance.now() + ms;
      const tick = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (now >= end || app.game.mode !== 'play') {
          input.stick.x = input.stick.y = 0;
          input.stick.run = false;
          cam.wantDistance = 3.6;
          resolve();
          return;
        }
        if (!app.character.flight?.active) {
          const p = app.character.position;
          const [e] = boss && app.game.boss?.alive ? [app.game.boss] : this.nearest(1, 30);
          if (e) {
            const dx = e.position.x - p.x;
            const dz = e.position.z - p.z;
            const d = Math.hypot(dx, dz) - e.radius;
            // Camera behind the hero, looking at the fight.
            const want = Math.atan2(-dx, -dz);
            const delta = ((want - cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            cam.yaw += delta * Math.min(1, dt * 3);
            cam.pitch += (0.3 - cam.pitch) * Math.min(1, dt * 2);
            // Walk in.
            const reach = boss ? 2.6 : 1.7;
            input.stick.y = d > reach ? 1 : 0;
            input.stick.x = 0;
            input.stick.run = d > 4;
            // Swing.
            cool -= dt;
            const sword = app.game.hasSword;
            if (cool <= 0 && d < reach + 0.6) {
              input.press(sword ? (Math.random() < 0.78 ? 'slashHit' : 'kick') : 'kick');
              cool = sword ? 0.32 : 0.45;
            } else if (sword && cool <= 0 && d > 4 && d < 7.5 && Math.random() < 0.04) {
              input.press('crouchSlash');
              cool = 0.8;
            }
            // Read the tells.
            for (const o of app.enemies.enemies) {
              if (!o.alive || o.ai !== 'windup' || dodged.has(o)) continue;
              const od = Math.hypot(o.position.x - p.x, o.position.z - p.z);
              const late = o.aiTime > o.type.windup * (dodgeEager ? 0.82 : 0.7);
              if (od < 3.2 * o.size && late) {
                dodged.add(o);
                input.stick.x = Math.random() < 0.5 ? 1 : -1;
                input.press('dodge');
                setTimeout(() => dodged.delete(o), 1500);
              }
            }
          } else {
            input.stick.x = input.stick.y = 0;
          }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
}

/* -------------------------------------------------------------------- */
/* the frame                                                             */
/* -------------------------------------------------------------------- */

/** WebGL frame + the DOM's cinematic chrome, drawn into one canvas. */
class Compositor {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.el = {
      letterbox: document.getElementById('letterbox'),
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

  draw() {
    const c = this.ctx;
    const gl = this.app.renderer.gl.domElement;
    c.drawImage(gl, 0, 0, W, H);
    const op = (el) => parseFloat(getComputedStyle(el).opacity) || 0;

    // slow-mo tint
    if (this.el.slowmo.classList.contains('on')) {
      const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
      g.addColorStop(0, 'rgba(40,120,255,0)');
      g.addColorStop(1, 'rgba(40,120,255,0.3)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    // letterbox (always on in the trailer: it is a film)
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
      c.fillText(spaced(ch.querySelector('small').textContent, 0.6), W / 2, H * 0.29);
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
      const y = H - bar - 46;
      c.shadowColor = '#000';
      c.shadowBlur = 10;
      for (const r of runs) {
        c.fillStyle = r.em ? '#ffb36b' : '#f6ece2';
        c.fillText(r.text, x, y);
        x += c.measureText(r.text).width;
      }
      c.restore();
    }

    // fade
    const fd = this.el.fade;
    const fo = op(fd);
    if (fo > 0.01) {
      c.fillStyle = fd.classList.contains('white') ? `rgba(255,246,234,${fo})` : `rgba(0,0,0,${fo})`;
      c.fillRect(0, 0, W, H);
    }

    // title card (over the fade)
    const tc = this.el.title;
    const to = op(tc);
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
      c.fillText(spaced(lines[0] ?? '', 0.3), W / 2, H * 0.4 + 172);
      if (lines[1]) {
        c.font = '500 20px Oswald, sans-serif';
        c.fillStyle = '#ffb36b';
        c.fillText(lines[1], W / 2, H * 0.4 + 212);
      }
      c.restore();
    }
  }
}

function spaced(text, em) {
  return [...text].join(em > 0.4 ? '  ' : ' ');
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
