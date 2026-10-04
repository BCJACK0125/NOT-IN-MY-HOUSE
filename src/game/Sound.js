import { Score, makeImpulse } from './Score.js';

/**
 * Everything you hear, synthesised with WebAudio — no sound files to download.
 *
 * The mix is three buses into a glue compressor and a limiter:
 *   music     the adaptive score (`Score.js`), ducked under the big hits
 *   sfx       short enveloped noise bursts and oscillators, with a little
 *             random pitch/level per play and a cap on how many of the same
 *             sound may start at once, so repeats never sound mechanical
 *   ambience  the black rain (clear outside, muffled indoors), wind, thunder
 * plus one generated hall reverb both the score and the effects send into —
 * wetter outdoors than in a flat.
 *
 * The game says which `cue` it wants and how intense things are; the score
 * does the rest (see `Score.js`).
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.8;
    this.intensity = 0;
    this.cue = 'title';
    this.indoor = 1;
    this._recent = new Map();
    this._thunder = 18;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // glue, then a brick-wall-ish limiter so nothing ever clips
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(glue).connect(limiter).connect(ctx.destination);

    // the hall
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.8, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.8;
    this.reverb.connect(wet).connect(this.master);

    // music
    this.music = ctx.createGain();
    this.music.gain.value = 0.62;
    this.musicDuck = ctx.createGain();
    this.music.connect(this.musicDuck).connect(this.master);
    this.score = new Score(ctx, this.music, this.reverb);

    // effects
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.12;
    this.sfx.connect(this.sfxSend).connect(this.reverb);

    this._white = this._noiseBuffer(2, false);
    this._brown = this._noiseBuffer(4, true);
    this._ambience();
  }

  /** Wind, distant city, and the black rain. */
  _ambience() {
    const ctx = this.ctx;
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.master);
    const wind = ctx.createBufferSource();
    wind.buffer = this._brown;
    wind.loop = true;
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.045;
    wind.connect(wlp).connect(this.windGain).connect(this.amb);
    wind.start();
    // rain: bright hiss outside, a dull wash through the walls
    const rain = ctx.createBufferSource();
    rain.buffer = this._white;
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.rainLp = ctx.createBiquadFilter();
    this.rainLp.type = 'lowpass';
    this.rainLp.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.02;
    rain.connect(hp).connect(this.rainLp).connect(this.rainGain).connect(this.amb);
    rain.start();
  }

  /** 0 = out in the plaza, 1 = inside the flat or the stairwell. */
  setSpace(indoor) {
    if (!this.ctx) return;
    this.indoor = indoor;
    const now = this.ctx.currentTime;
    this.rainLp.frequency.setTargetAtTime(1300 + (1 - indoor) * 6000, now, 0.4);
    this.rainGain.gain.setTargetAtTime(0.018 + (1 - indoor) * 0.05, now, 0.4);
    this.windGain.gain.setTargetAtTime(0.03 + (1 - indoor) * 0.03, now, 0.4);
    this.sfxSend.gain.setTargetAtTime(0.08 + (1 - indoor) * 0.16, now, 0.4);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  _noiseBuffer(sec, brown) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  /** At most `max` starts of the same sound inside `window` seconds. */
  _allow(key, max = 4, window = 0.09) {
    if (!key || !this.ctx) return true;
    const now = this.ctx.currentTime;
    const list = (this._recent.get(key) ?? []).filter((t) => now - t < window);
    if (list.length >= max) return false;
    list.push(now);
    this._recent.set(key, list);
    return true;
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, attack = 0.005, slide = 0, out = null, vary = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (vary) {
      freq *= 1 + (Math.random() * 2 - 1) * vary;
      vol *= 1 + (Math.random() * 2 - 1) * vary * 2;
    }
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { freq = 800, q = 1, vol = 0.2, type = 'bandpass', delay = 0, sweep = 0, attack = 0.002, out = null, vary = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (vary) {
      freq *= 1 + (Math.random() * 2 - 1) * vary;
      vol *= 1 + (Math.random() * 2 - 1) * vary * 2;
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /* ---- effects ---------------------------------------------------- */
  swing(heavy = false) {
    if (!this._allow('swing', 2)) return;
    this.noise(heavy ? 0.32 : 0.22, { freq: heavy ? 900 : 1500, sweep: 0.35, q: 1.4, vol: heavy ? 0.22 : 0.16, attack: 0.04, vary: 0.08 });
  }
  slash() {
    if (!this._allow('slash', 2)) return;
    this.noise(0.18, { freq: 3500, sweep: 0.5, q: 3, vol: 0.25, vary: 0.07 });
    this.tone(1900, 0.12, { type: 'triangle', vol: 0.05, slide: 0.6, vary: 0.05 });
  }
  hit(heavy = false) {
    if (!this._allow('hit', 3)) return;
    this.noise(0.12, { freq: 260, q: 0.9, vol: heavy ? 0.6 : 0.42, type: 'lowpass', vary: 0.08 });
    this.tone(heavy ? 70 : 95, heavy ? 0.28 : 0.16, { type: 'sine', vol: heavy ? 0.5 : 0.35, slide: 0.5, vary: 0.06 });
    this.noise(0.06, { freq: 2500, q: 1, vol: 0.12, vary: 0.1 });
    if (heavy) this.duckMusic(0.7, 0.35);
  }
  cut() {
    if (!this._allow('cut', 2)) return;
    this.noise(0.35, { freq: 1200, sweep: 0.3, q: 0.8, vol: 0.35, vary: 0.08 });
    this.noise(0.5, { freq: 300, q: 0.5, vol: 0.18, type: 'lowpass', delay: 0.04, vary: 0.08 });
    this.duckMusic(0.72, 0.4);
  }
  hurt() {
    this.tone(160, 0.25, { type: 'sawtooth', vol: 0.12, slide: 0.6, vary: 0.08 });
    this.duckMusic(0.7, 0.3);
    this.noise(0.2, { freq: 400, q: 1, vol: 0.4, type: 'lowpass' });
  }
  dodge() {
    this.noise(0.2, { freq: 600, sweep: 3, q: 1, vol: 0.14, attack: 0.03 });
  }
  perfect() {
    this.tone(1320, 0.6, { type: 'sine', vol: 0.12 });
    this.tone(1760, 0.8, { type: 'sine', vol: 0.08, delay: 0.05 });
    this.noise(0.6, { freq: 5000, sweep: 0.2, q: 2, vol: 0.08 });
  }
  growl(big = false) {
    if (!this._allow('growl', 2, 0.6)) return;
    this.tone(big ? 55 : 85 + Math.random() * 30, big ? 1.2 : 0.6, { type: 'sawtooth', vol: big ? 0.18 : 0.08, slide: 0.7, attack: 0.08 });
    this.noise(big ? 1.1 : 0.5, { freq: big ? 220 : 380, q: 4, vol: big ? 0.25 : 0.1, attack: 0.1, sweep: 0.6 });
  }
  /** The tell's ring: a bright ting for a swing, a low metal scrape for a slam. */
  glint(heavy = false) {
    if (!this._allow('glint', 2, 0.12)) return;
    if (heavy) {
      this.tone(620, 0.35, { type: 'triangle', vol: 0.07, slide: 0.6, vary: 0.04 });
      this.noise(0.3, { freq: 2400, q: 8, vol: 0.05, sweep: 0.5 });
    } else {
      this.tone(2650, 0.22, { type: 'sine', vol: 0.06, vary: 0.05 });
      this.tone(3975, 0.16, { type: 'sine', vol: 0.03, delay: 0.01, vary: 0.05 });
    }
  }
  /** The last of a wave goes down: a deep hit under the cut. */
  finisher() {
    this.tone(70, 0.9, { type: 'sine', vol: 0.5, slide: 0.45 });
    this.noise(0.5, { freq: 900, q: 0.8, vol: 0.18, sweep: 0.3 });
    this.tone(1760, 0.9, { type: 'sine', vol: 0.05, delay: 0.08 });
  }
  windup() {
    this.noise(0.4, { freq: 300, sweep: 4, q: 6, vol: 0.06, attack: 0.3 });
  }
  slam() {
    this.duckMusic(0.55, 0.6);
    this.tone(45, 0.9, { type: 'sine', vol: 0.7, slide: 0.5 });
    this.noise(0.8, { freq: 180, q: 0.7, vol: 0.6, type: 'lowpass' });
  }
  step(surface = 'tile') {
    this.noise(0.06, { freq: surface === 'wood' ? 300 : surface === 'street' ? 700 : 1400, q: 0.8, vol: 0.035, vary: 0.12 });
  }
  pickup() {
    [784, 988, 1318].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.09, delay: i * 0.06 }));
  }
  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.6, { vol: 0.1, delay: i * 0.09, type: 'triangle' }));
  }
  ding() {
    this.tone(1318.5, 1.2, { vol: 0.16 });
    this.tone(1046.5, 1.5, { vol: 0.16, delay: 0.32 });
  }
  hum(dur) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.5);
    g.gain.setValueAtTime(0.08, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  powerDown() {
    this.tone(220, 1.4, { type: 'sawtooth', vol: 0.12, slide: 0.15 });
    this.noise(0.25, { freq: 3000, q: 2, vol: 0.2 });
  }
  metal() {
    this.noise(0.5, { freq: 2600, q: 8, vol: 0.18 });
    this.tone(420, 0.6, { type: 'square', vol: 0.03 });
  }
  door() {
    this.noise(0.3, { freq: 400, q: 2, vol: 0.12 });
    this.tone(180, 0.15, { type: 'triangle', vol: 0.06 });
  }
  ignite() {
    this.noise(1.2, { freq: 800, sweep: 0.4, q: 0.6, vol: 0.3, attack: 0.05 });
    this.tone(110, 1.4, { type: 'sawtooth', vol: 0.06, slide: 2 });
  }
  roar() {
    this.growl(true);
    this.tone(38, 2, { type: 'sine', vol: 0.5, attack: 0.2, slide: 0.8 });
  }
  heartbeat() {
    this.tone(60, 0.12, { vol: 0.35 });
    this.tone(55, 0.14, { vol: 0.25, delay: 0.18 });
  }
  siren() {
    this.tone(700, 0.45, { type: 'square', vol: 0.025, slide: 1.4 });
    this.tone(980, 0.45, { type: 'square', vol: 0.025, slide: 0.7, delay: 0.45 });
  }
  /** A rising sweep into a cut (trailer). */
  riser(dur = 3) {
    if (!this.ctx) return;
    this.noise(dur, { freq: 300, sweep: 14, q: 1.2, vol: 0.22, attack: dur * 0.95 });
    this.tone(110, dur, { type: 'sawtooth', vol: 0.08, slide: 4, attack: dur * 0.9 });
  }

  /** The big hit under a title card. */
  boom() {
    this.tone(40, 3, { type: 'sine', vol: 0.9, slide: 0.6 });
    this.noise(2.2, { freq: 90, q: 0.5, vol: 0.8, type: 'lowpass' });
    this.noise(1.2, { freq: 2400, sweep: 0.2, q: 0.7, vol: 0.18 });
  }

  /** Fade everything (music and effects) toward `level` over `time` seconds. */
  duck(level, time = 0.3) {
    if (!this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * level, now, time / 3);
  }

  sting() {
    // the title hit
    this.tone(55, 2.5, { type: 'sawtooth', vol: 0.18, slide: 0.5 });
    this.noise(1.8, { freq: 120, q: 0.6, vol: 0.5, type: 'lowpass' });
    this.slash();
  }

  /* ---- score ------------------------------------------------------ */

  /** Pull the music down under a big moment, then let it back up. */
  duckMusic(level = 0.7, hold = 0.35) {
    if (!this.musicDuck) return;
    const now = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(level, now + 0.04);
    g.setTargetAtTime(1, now + hold, 0.25);
  }

  /** A short musical punctuation: 'chapter' · 'reveal' · 'victory' · 'death'. */
  stinger(kind) {
    if (!this.score) return;
    this.duckMusic(0.5, 0.8);
    this.score.stinger(kind);
  }

  /** Called every frame. */
  update(dt) {
    if (!this.ctx || !this.score) return;
    let cue = this.cue;
    let intensity = this.intensity;
    // a director (the trailer) can hold the score where it wants it
    if (this.override !== undefined && this.override !== null) {
      intensity = this.override;
      cue = this.calmOverride ? 'cinematic' : this.override > 0.3 ? 'combat' : 'explore';
    }
    this.score.intensity = intensity;
    this.score.set(cue);
    this.score.update(dt);
    // distant thunder now and then, outdoors louder
    this._thunder -= dt;
    if (this._thunder <= 0) {
      this._thunder = 22 + Math.random() * 35;
      if (cue !== 'title' && cue !== 'dawn') {
        const v = 0.12 + (1 - this.indoor) * 0.18;
        this.noise(3.5, { freq: 160, q: 0.5, vol: v, type: 'lowpass', attack: 0.4, out: this.amb });
        this.tone(36, 3, { vol: v * 0.8, attack: 0.5, out: this.amb });
      }
    }
  }
}
