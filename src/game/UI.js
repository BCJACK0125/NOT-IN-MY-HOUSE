import { Vector3 } from 'three';
import { settings } from '../config/settings.js';

const $ = (id) => document.getElementById(id);
const _p = new Vector3();

/** All DOM: HUD, menus, subtitles, floating numbers, touch controls. */
export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      hud: $('game-hud'), hp: $('hpFill'), hpGhost: $('hpGhost'), sp: $('spFill'), spText: $('spText'),
      chapter: $('objChapter'), obj: $('objText'), floor: $('floorText'), kills: $('killText'),
      combo: $('combo'), comboNum: $('comboNum'), bossbar: $('bossbar'), bossFill: $('bossFill'), bossName: $('bossName'),
      prompt: $('prompt'), promptText: $('promptText'), subtitle: $('subtitle'), card: $('chapterCard'),
      vignette: $('vignette'), slowmo: $('slowmo'), dmg: $('dmg'), letterbox: $('letterbox'), skip: $('skipHint'),
      fade: $('fade'), titleCard: $('titleCard'), title: $('title'), help: $('help'), pause: $('pause'),
      gameover: $('gameover'), ending: $('ending'), stats: $('stats'), note: $('note'), touch: $('touch'),
      click: $('clickToPlay')
    };
    this._sub = 0;
    this._hurt = 0;
    this._last = {};
    this._nums = [];
    this.bossTarget = null;
    this.noteOpen = false;
    this.gameoverOpen = false;
    this._wire();
  }

  _wire() {
    const app = this.app;
    const game = () => app.game;
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); app.sound.init(); fn(); });
    click('btnStart', () => { this.landscape(); game().newGame({ intro: true }); });
    click('btnSkipIntro', () => { this.landscape(); game().newGame({ intro: false }); });
    click('btnContinue', () => { this.landscape(); game().continueFromSave(); });
    this.el.skip.querySelector('.skip-hint__btn').addEventListener('click', (e) => { e.stopPropagation(); game().cine.skip(); });
    click('btnHelp', () => this.el.help.classList.remove('hidden'));
    click('btnChapters', () => $('chapters').classList.remove('hidden'));
    click('btnTrailer', () => {
      app.sound.setMuted(true);
      $('trailer').classList.remove('hidden');
      const v = $('trailerVideo');
      v.currentTime = 0;
      v.play().catch(() => {});
    });
    click('btnTrailerClose', () => {
      const v = $('trailerVideo');
      v.pause();
      $('trailer').classList.add('hidden');
      app.sound.setMuted(!$('optSound').checked);
    });
    click('btnChaptersBack', () => $('chapters').classList.add('hidden'));
    click('btnPauseHelp', () => this.el.help.classList.remove('hidden'));
    this.el.help.querySelector('[data-close]').addEventListener('click', () => this.el.help.classList.add('hidden'));
    click('btnResume', () => game().pause(false));
    click('btnRetry', () => { app.paused = false; this.pause(false); game().retry(); });
    click('btnQuit', () => game().quitToTitle());
    click('btnRevive', () => game().retry());
    click('btnAgain', () => game().quitToTitle());
    $('optSound').addEventListener('change', (e) => app.sound.setMuted(!e.target.checked));
    $('optVol').addEventListener('input', (e) => app.sound.setVolume(+e.target.value));
    $('optSens').addEventListener('input', (e) => { app.cam.sensitivity = +e.target.value; });
    $('optHigh').addEventListener('change', (e) => this.setQuality(e.target.checked));
    this.el.click.addEventListener('click', () => { this.el.click.classList.add('hidden'); app.cam.lock(); });
    this.el.note.addEventListener('click', () => { if (this.noteOpen) { this.note(false); game().step?.onNoteClosed?.(game()); } });
    // Clicking the canvas during play takes the mouse back.
    app.canvas.addEventListener('click', () => {
      if (game().mode === 'play' && !app.paused && !document.pointerLockElement) app.cam.lock();
    });
    if (app.isTouch) this._touch();
    // Browsers only start audio after a gesture: the first one on the title
    // screen starts the title theme.
    const wake = () => app.sound.init();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    this.setQuality(false);
    this.hud(false);
  }

  /** Phones: fullscreen and lock to landscape where allowed (Android); iOS gets the overlay. */
  landscape() {
    if (!this.app.isTouch) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const lock = () => { try { const p = screen.orientation?.lock?.('landscape'); p?.catch?.(() => {}); } catch { /* unsupported */ } };
    try {
      if (req && !document.fullscreenElement) {
        const p = req.call(el, { navigationUI: 'hide' });
        if (p?.then) p.then(lock, () => {}); else lock();
      } else lock();
    } catch { /* ignore */ }
    setTimeout(() => this._checkRotate?.(), 300);
  }

  setQuality(high) {
    const r = this.app.renderer;
    r.targetPixelRatio = () => Math.min(window.devicePixelRatio || 1, high ? 1.75 : this.app.isTouch ? 1 : 1.25);
    settings.post.samples = high ? 4 : 0;
    settings.groundFog.count = this.app.isTouch ? (high ? 80 : 50) : high ? 160 : 110;
    r.handleResize();
  }

  difficulty() {
    return +$('optDiff').value || 1;
  }

  setDifficulty(v) {
    $('optDiff').value = String(v);
  }

  /* ---- screens ---------------------------------------------------- */
  title(on) {
    this.el.title.classList.toggle('hidden', !on);
    if (on) document.body.classList.add('cinematic');
    else document.body.classList.remove('cinematic');
  }
  continueButton(show) { $('btnContinue').classList.toggle('hidden', !show); }

  /** Cards for every chapter; the ones not reached yet are locked. */
  chapterSelect(chapters, unlocked) {
    const list = $('chapterList');
    list.innerHTML = '';
    let open = 0;
    chapters.forEach((c, i) => {
      const ok = unlocked.has(c.id);
      if (ok) open++;
      const b = document.createElement('button');
      b.className = `chapter${ok ? '' : ' is-locked'}`;
      b.disabled = !ok;
      b.innerHTML = `<span class="chapter__no">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="chapter__small">${c.small}</span><b class="chapter__title">${c.title}</b>` +
        `<span class="chapter__desc">${ok ? c.desc : '尚未到達'}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!ok) return;
        this.app.sound.init();
        $('chapters').classList.add('hidden');
        this.landscape();
        this.app.game.startChapter(c.id);
      });
      list.appendChild(b);
    });
    $('btnChapters').classList.toggle('hidden', open < 2);
  }
  hud(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.app.actionHUD.element.style.display = on ? '' : 'none';
    if (this.app.isTouch) this.el.touch.classList.toggle('hidden', !on);
  }
  pause(on) {
    this.el.pause.classList.toggle('hidden', !on);
    if (!on) this.el.help.classList.add('hidden');
  }
  gameover(on) {
    this.gameoverOpen = on;
    this.el.gameover.classList.toggle('hidden', !on);
    if (on) {
      const lines = ['家，還沒守住。', '再站起來。這是你家。', '它們不屬於這裡。', '爺爺的刀還在等你。'];
      $('deathLine').textContent = lines[(Math.random() * lines.length) | 0];
    }
  }
  ending(on, stats = null) {
    this.el.ending.classList.toggle('hidden', !on);
    if (on && stats) {
      const t = Math.round(stats.time);
      const rows = [
        ['通關時間', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
        ['擊倒', stats.kills],
        ['最高連擊', stats.maxCombo],
        ['見切', stats.perfect],
        ['倒下次數', stats.deaths],
        ['評價', rank(stats)]
      ];
      this.el.stats.innerHTML = rows.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
    }
  }
  note(on) {
    this.noteOpen = on;
    this.el.note.classList.toggle('hidden', !on);
    if (on) { this.app.game._unlockedOnPurpose = performance.now(); this.app.cam.unlock(); }
    else if (this.app.game.mode === 'play') this.app.cam.lock();
  }

  /* ---- cinematic chrome ----------------------------------------- */
  letterbox(on) { this.el.letterbox.classList.toggle('on', on); }
  skipHint(on) { this.el.skip.classList.toggle('hidden', !on); }
  fade(on, white = false) {
    this.el.fade.classList.toggle('white', white);
    this.el.fade.classList.toggle('on', on);
  }
  titleCard(on) { this.el.titleCard.classList.toggle('on', on); }
  subtitle(text, seconds = 0) {
    const s = this.el.subtitle;
    if (!text) { s.classList.remove('on'); return; }
    s.innerHTML = text;
    s.classList.add('on');
    this._sub = seconds;
  }
  chapterCard(small, big) {
    const c = this.el.card;
    c.querySelector('small').textContent = small;
    c.querySelector('b').textContent = big;
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
  }

  /* ---- HUD -------------------------------------------------------- */
  objective(chapter, text) {
    this.el.chapter.textContent = chapter;
    this.objectiveText(text, true);
  }
  objectiveText(text, flash = false) {
    if (this._last.obj === text) return;
    this._last.obj = text;
    this.el.obj.textContent = text;
    if (flash) {
      this.el.obj.classList.remove('flash');
      void this.el.obj.offsetWidth;
      this.el.obj.classList.add('flash');
    }
  }
  prompt(text) {
    if (this._last.prompt === text) return;
    this._last.prompt = text;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.promptText.textContent = text;
    this._useBtn?.classList.toggle('ready', !!text);
  }
  combo(n) {
    this.el.combo.classList.toggle('on', n >= 2);
    if (n >= 2) {
      this.el.comboNum.textContent = n;
      this.el.comboNum.classList.remove('pop');
      void this.el.comboNum.offsetWidth;
      this.el.comboNum.classList.add('pop');
    }
  }
  hurt(damage) {
    this._hurt = Math.min(1, this._hurt + 0.35 + damage / 40);
    this.damageNumber(this.app.character.position.clone().setY(this.app.character.position.y + 1.9), `-${damage}`, 'bad');
  }
  slowmo(on) { this.el.slowmo.classList.toggle('on', on); }
  boss(enemy) {
    this.bossTarget = enemy;
    this.el.bossbar.classList.toggle('hidden', !enemy);
    if (enemy) this.el.bossName.textContent = enemy.type.name;
  }

  damageNumber(pos, text, cls = '') {
    const d = document.createElement('div');
    d.className = `dmg ${cls}`;
    d.textContent = text;
    this.el.dmg.appendChild(d);
    this._nums.push({ el: d, pos: pos.clone(), t: 0, life: cls === 'word' ? 1.4 : 0.9, dx: (Math.random() - 0.5) * 30 });
    while (this._nums.length > 24) this._nums.shift().el.remove();
  }

  update(dt, game) {
    const el = this.el;
    const hpK = game.hp / game.maxHp;
    if (this._last.hp !== game.hp) {
      this._last.hp = game.hp;
      el.hp.style.transform = `scaleX(${hpK})`;
      el.hpGhost.style.transform = `scaleX(${hpK})`;
      el.hud.classList.toggle('low', hpK < 0.3);
    }
    const sp = Math.floor(game.spirit);
    if (this._last.sp !== sp) {
      this._last.sp = sp;
      el.sp.style.transform = `scaleX(${sp / 100})`;
      el.spText.textContent = `氣 ${sp}`;
      el.sp.parentElement.classList.toggle('is-full', sp >= 100);
    }
    if (this._abilityBtns && game.mode === 'play') {
      const sp = game.spirit;
      for (const b of this._abilityBtns) {
        const need = +b.dataset.cost;
        const off = sp < need || (b.dataset.t === 'flight' && !game.canFly() && !this.app.character.flight?.active);
        if (b._off !== off) { b._off = off; b.classList.toggle('off', off); }
      }
    }
    const floor = game.floorLabel();
    if (this._last.floor !== floor) { this._last.floor = floor; el.floor.textContent = floor; }
    if (this._last.kills !== game.stats.kills) { this._last.kills = game.stats.kills; el.kills.textContent = game.stats.kills; }
    if (this.bossTarget) {
      const k = Math.max(0, this.bossTarget.hp / this.bossTarget.maxHp);
      el.bossFill.style.transform = `scaleX(${k})`;
      if (!this.bossTarget.alive) this.boss(null);
    }
    this._hurt = Math.max(0, this._hurt - dt * 1.2);
    const low = hpK < 0.3 && game.mode === 'play' ? 0.35 + Math.sin(performance.now() * 0.006) * 0.12 : 0;
    el.vignette.style.opacity = Math.max(this._hurt, low).toFixed(3);
    if (this._sub > 0) {
      this._sub -= dt;
      if (this._sub <= 0) el.subtitle.classList.remove('on');
    }
    // floating numbers
    const cam = this.app.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this._nums.length - 1; i >= 0; i--) {
      const n = this._nums[i];
      n.t += 1 / 60;
      const k = n.t / n.life;
      if (k >= 1) { n.el.remove(); this._nums.splice(i, 1); continue; }
      _p.copy(n.pos);
      _p.y += k * 0.6;
      _p.project(cam);
      if (_p.z > 1) { n.el.style.opacity = 0; continue; }
      n.el.style.left = `${((_p.x + 1) / 2) * w + n.dx}px`;
      n.el.style.top = `${((1 - _p.y) / 2) * h}px`;
      n.el.style.opacity = String(1 - k * k);
    }
  }

  /* ---- touch ------------------------------------------------------ */
  _touch() {
    document.body.classList.add('touch-ui');
    const foot = document.querySelector('.title__foot');
    if (foot) foot.textContent = '手機請橫放遊玩 · 第一次載入約 35 MB，建議使用 Wi-Fi';
    const app = this.app;
    const stick = $('stick');
    const knob = stick.querySelector('i');
    let sid = null, sx = 0, sy = 0;
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      const r = stick.getBoundingClientRect();
      sx = r.left + r.width / 2;
      sy = r.top + r.height / 2;
      try { stick.setPointerCapture(sid); } catch { /* synthetic pointer */ }
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      let dx = (e.clientX - sx) / 60;
      let dy = (e.clientY - sy) / 60;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      app.input.stick.x = dx;
      app.input.stick.y = -dy;
      app.input.stick.run = l > 0.92;
      knob.style.transform = `translate(${dx * 35}px, ${dy * 35}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      app.input.stick.x = app.input.stick.y = 0;
      app.input.stick.run = false;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    this._useBtn = document.querySelector('#touch [data-t="use"]');
    this._abilityBtns = [...document.querySelectorAll('#touch .ta')];
    for (const b of document.querySelectorAll('#touch [data-t]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = b.dataset.t;
        const g = app.game;
        if (t === 'pause') g.pause(true);
        else if (t === 'shadows' || t === 'judgement' || t === 'flight') g.ability(t);
        else if (t === 'dodge' && app.character.flight?.flying) app._loose();
        else if (t === 'use' && this.noteOpen) { this.note(false); g.step?.onNoteClosed?.(g); }
        else app.input.press(t);
      });
    }
    // Holding the phone upright: cover the screen and hold the game.
    const portrait = matchMedia('(orientation: portrait)');
    const check = () => {
      const g = app.game;
      const show = portrait.matches && g && g.mode !== 'title' && g.mode !== 'loading';
      $('rotate').classList.toggle('hidden', !show);
      if (show && g.mode === 'play' && !app.paused) { this._rotatePaused = true; app.paused = true; }
      if (!show && this._rotatePaused) { this._rotatePaused = false; if (!this.el.pause.classList.contains('hidden')) return; app.paused = false; }
    };
    portrait.addEventListener?.('change', check);
    window.addEventListener('resize', check);
    this._checkRotate = check;
    // drag anywhere else to look
    let lid = null, lx = 0, ly = 0;
    app.canvas.addEventListener('pointerdown', (e) => { if (lid === null) { lid = e.pointerId; lx = e.clientX; ly = e.clientY; } });
    app.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lid) return;
      app.cam.look(e.clientX - lx, e.clientY - ly, 0.006);
      lx = e.clientX;
      ly = e.clientY;
    });
    const lend = (e) => { if (e.pointerId === lid) lid = null; };
    app.canvas.addEventListener('pointerup', lend);
    app.canvas.addEventListener('pointercancel', lend);
  }
}

function rank(s) {
  let score = s.kills * 10 + s.maxCombo * 20 + s.perfect * 30 - s.deaths * 120 - Math.max(0, s.time - 900) * 0.5;
  if (score > 1200) return 'S　家的守護神';
  if (score > 800) return 'A　鋼鐵住戶';
  if (score > 450) return 'B　好鄰居';
  return 'C　平安就好';
}
