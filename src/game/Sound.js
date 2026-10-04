/**
 * Everything you hear, synthesised with WebAudio — no sound files to download.
 *
 * Effects are short enveloped noise bursts and oscillators. The score is two
 * layers that cross-fade on `intensity` (0 calm → 1 fight): a low drone with a
 * slow minor pad, and a pulse of taiko-like hits and a sub bass that only comes
 * in when blades are out.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.8;
    this.intensity = 0;
    this._intensity = 0;
    this._beat = 0;
    this._step = 0;
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this._white = this._noiseBuffer(1, false);
    this._brown = this._noiseBuffer(4, true);
    // wind / distant city
    const amb = ctx.createBufferSource();
    amb.buffer = this._brown;
    amb.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    amb.connect(lp).connect(this.ambGain).connect(this.master);
    amb.start();
    this._startScore();
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

  tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, attack = 0.005, slide = 0, out = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
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

  noise(dur, { freq = 800, q = 1, vol = 0.2, type = 'bandpass', delay = 0, sweep = 0, attack = 0.002, out = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
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
    this.noise(heavy ? 0.32 : 0.22, { freq: heavy ? 900 : 1500, sweep: 0.35, q: 1.4, vol: heavy ? 0.22 : 0.16, attack: 0.04 });
  }
  slash() {
    this.noise(0.18, { freq: 3500, sweep: 0.5, q: 3, vol: 0.25 });
    this.tone(1900, 0.12, { type: 'triangle', vol: 0.05, slide: 0.6 });
  }
  hit(heavy = false) {
    this.noise(0.12, { freq: 260, q: 0.9, vol: heavy ? 0.6 : 0.42, type: 'lowpass' });
    this.tone(heavy ? 70 : 95, heavy ? 0.28 : 0.16, { type: 'sine', vol: heavy ? 0.5 : 0.35, slide: 0.5 });
    this.noise(0.06, { freq: 2500, q: 1, vol: 0.12 });
  }
  cut() {
    this.noise(0.35, { freq: 1200, sweep: 0.3, q: 0.8, vol: 0.35 });
    this.noise(0.5, { freq: 300, q: 0.5, vol: 0.18, type: 'lowpass', delay: 0.04 });
  }
  hurt() {
    this.tone(160, 0.25, { type: 'sawtooth', vol: 0.12, slide: 0.6 });
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
    this.tone(big ? 55 : 85 + Math.random() * 30, big ? 1.2 : 0.6, { type: 'sawtooth', vol: big ? 0.18 : 0.08, slide: 0.7, attack: 0.08 });
    this.noise(big ? 1.1 : 0.5, { freq: big ? 220 : 380, q: 4, vol: big ? 0.25 : 0.1, attack: 0.1, sweep: 0.6 });
  }
  windup() {
    this.noise(0.4, { freq: 300, sweep: 4, q: 6, vol: 0.06, attack: 0.3 });
  }
  slam() {
    this.tone(45, 0.9, { type: 'sine', vol: 0.7, slide: 0.5 });
    this.noise(0.8, { freq: 180, q: 0.7, vol: 0.6, type: 'lowpass' });
  }
  step(surface = 'tile') {
    this.noise(0.06, { freq: surface === 'wood' ? 300 : surface === 'street' ? 700 : 1400, q: 0.8, vol: 0.03 + Math.random() * 0.015 });
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
  sting() {
    // the title hit
    this.tone(55, 2.5, { type: 'sawtooth', vol: 0.18, slide: 0.5 });
    this.noise(1.8, { freq: 120, q: 0.6, vol: 0.5, type: 'lowpass' });
    this.slash();
  }

  /* ---- score ------------------------------------------------------ */
  _startScore() {
    const ctx = this.ctx;
    // Drone: two detuned saws through a slow-moving filter.
    this.drone = ctx.createGain();
    this.drone.gain.value = 0.0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    f.Q.value = 4;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(f.frequency);
    lfo.start();
    for (const freq of [55, 55.4, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = freq > 80 ? 0.05 : 0.09;
      o.connect(g).connect(f);
      o.start();
    }
    f.connect(this.drone).connect(this.music);
    this.fight = ctx.createGain();
    this.fight.gain.value = 0;
    this.fight.connect(this.music);
    this._next = ctx.currentTime + 0.1;
  }

  /** Called every frame. Schedules the fight layer a beat ahead. */
  update(dt) {
    if (!this.ctx || !this.drone) return;
    this._intensity += (this.intensity - this._intensity) * Math.min(1, dt * 0.8);
    const now = this.ctx.currentTime;
    this.drone.gain.setTargetAtTime(this.calm ? 0.08 : 0.32 - this._intensity * 0.1, now, 0.5);
    this.fight.gain.setTargetAtTime(this._intensity * 0.9, now, 0.3);
    const bpm = 132;
    const beat = 60 / bpm / 2;
    while (this._next < now + 0.2) {
      const t = this._next;
      const s = this._step++ % 16;
      const delay = t - now;
      if (this._intensity > 0.05) {
        if (s === 0 || s === 6 || s === 10) this._drum(delay, 1);
        if (s === 4 || s === 12) this._drum(delay, 0.6, true);
        if (s % 2 === 0) this.tone([55, 55, 65.4, 49][(this._step >> 4) % 4], beat * 1.6, { type: 'square', vol: 0.06, delay, out: this.fight });
        if (s === 14) this.noise(0.08, { freq: 6000, q: 1, vol: 0.05, delay, out: this.fight });
      }
      this._next += beat;
    }
  }

  _drum(delay, vol, high = false) {
    this.tone(high ? 140 : 62, 0.35, { type: 'sine', vol: 0.5 * vol, slide: 0.45, delay, out: this.fight });
    this.noise(0.12, { freq: high ? 1200 : 200, q: 0.8, vol: 0.25 * vol, type: high ? 'bandpass' : 'lowpass', delay, out: this.fight });
  }
}
