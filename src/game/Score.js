/**
 * The adaptive score — synthesised, no audio files.
 *
 * Built the way game scores usually are:
 *  - **Horizontal re-sequencing**: one cue per state (title · explore · combat ·
 *    boss · cinematic · dawn · death). A change waits for the next beat (into a
 *    fight) or bar (everything else) and crossfades over ~2 s.
 *  - **Vertical layering**: inside a cue, stems fade in and out with one
 *    `intensity` value (how many shades are on you, the boss's phase…).
 *  - **Stingers**: short one-shots on story beats (chapter, boss reveal,
 *    victory, death), laid on top of whatever is playing.
 *  - One **theme** ("home") runs through it: a music box in D minor on the
 *    title, the same tune in D major at dawn.
 *
 * Everything is scheduled ahead on the audio clock (lookahead scheduler), so
 * timing is sample-accurate whatever the frame rate. It also works on an
 * OfflineAudioContext (`scheduleUntil`), which is how the mix is measured.
 */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Chord tones from a root, in MIDI. */
function chord(root, kind = 'm') {
  const third = kind === 'M' ? 4 : 3;
  const fifth = kind === 'dim' ? 6 : 7;
  return [root, root + third, root + fifth];
}

const C = {
  Dm: chord(50), Bb: chord(46, 'M'), Gm: chord(43), A: chord(45, 'M'), F: chord(41, 'M'),
  Eb: chord(51 - 12, 'M'), D: chord(50, 'M'), G: chord(43, 'M'), Bm: chord(47), C: chord(48, 'M')
};

/** "Home": 4 bars of 16 steps — [step, midi, length in steps]. */
const THEME_MINOR = [
  [0, 74, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4],
  [16, 72, 6], [22, 69, 2], [24, 69, 8],
  [32, 70, 4], [36, 69, 4], [40, 67, 4], [44, 65, 4],
  [48, 64, 6], [54, 65, 2], [56, 62, 8]
];
const THEME_MAJOR = THEME_MINOR.map(([s, m, l]) => [s, { 77: 78, 72: 73, 70: 71, 65: 66 }[m] ?? m, l]);

/** Freeze a param's automation at `at` (falls back to `value` if unsupported). */
function holdAt(param, at, value) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
  else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(value, at);
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* -------------------------------------------------------------------- */
/* the cues                                                              */
/* -------------------------------------------------------------------- */

const CUES = {
  title: {
    bpm: 66, prog: [C.Dm, C.F, C.Bb, C.A], quant: 16,
    layers: { pad: () => 0.8, drone: () => 0.7, theme: () => 1 },
    play(s, step, t, ch, bar) {
      if (step % 16 === 0) { s.pad('pad', ch, t, s.bar(this) * 1.02, 900); s.drone('drone', ch[0] - 12, t, s.bar(this)); }
      s.melody('theme', THEME_MINOR, step, t, 'box');
    }
  },
  explore: {
    bpm: 72, prog: [C.Dm, C.Dm, C.Bb, C.Eb], quant: 16,
    layers: { pad: () => 0.8, drone: () => 0.9, piano: () => 0.7, tension: (i) => 1.6 * smooth(0.15, 0.6, i) },
    play(s, step, t, ch, bar) {
      if (step % 16 === 0) { s.pad('pad', ch, t, s.bar(this) * 1.05, 700); s.drone('drone', ch[0] - 12, t, s.bar(this)); }
      if (step % 4 === 2 && s.rand() < 0.35) s.piano('piano', ch[(s.rand() * 3) | 0] + 24, t);
      if (s.level('tension') > 0.02) {
        if (step % 16 === 0 || step % 16 === 3) s.thump('tension', t, step % 16 === 0 ? 1 : 0.7);
        if (step % 16 === 0) s.tremolo('tension', ch[2] + 24, t, s.bar(this));
      }
    }
  },
  combat: {
    bpm: 132, prog: [C.Dm, C.Bb, C.Gm, C.A], quant: 4,
    layers: {
      pad: () => 0.75, pulse: () => 1.3, bass: () => 1.25,
      taiko: (i) => 0.35 + 0.65 * smooth(0.1, 0.45, i), perc: (i) => smooth(0.4, 0.75, i), stabs: (i) => smooth(0.6, 0.95, i)
    },
    play(s, step, t, ch, bar) {
      const k = step % 16;
      if (k === 0) s.pad('pad', ch, t, s.bar(this), 1200);
      // 16th-note ostinato through the chord, with a dotted-eighth echo
      const arp = [0, 2, 1, 2, 0, 2, 1, 3][k % 8];
      s.pluck('pulse', (arp === 3 ? ch[0] + 12 : ch[arp]) + 24, t, k % 4 === 0 ? 1 : 0.7);
      if (k % 2 === 0) s.bass('bass', ch[0] - 12 + (k === 6 || k === 14 ? 12 : 0), t, s.step(this) * 1.8);
      if ([0, 3, 6, 8, 11, 14].includes(k)) s.taiko('taiko', t, k === 0 || k === 8 ? 1 : 0.6);
      if (bar % 4 === 3 && k >= 12) s.taiko('taiko', t, 0.5 + (k - 12) * 0.15, 1.25);
      if (k % 4 === 2) s.hat('perc', t, k === 14);
      if (k === 4 || k === 12) s.rim('perc', t);
      if ((bar % 2 === 0 && k === 0) || (bar % 4 === 3 && k === 10)) s.brass('stabs', ch, t, s.step(this) * 3);
    }
  },
  boss: {
    bpm: 140, prog: [C.Dm, C.Eb, C.Dm, C.A], quant: 4,
    layers: {
      choir: () => 0.8, bass: () => 0.9, taiko: () => 1, brass: () => 0.85,
      pulse: (i) => smooth(0.2, 0.6, i), perc: (i) => smooth(0.5, 0.9, i)
    },
    play(s, step, t, ch, bar) {
      const k = step % 16;
      if (k === 0) { s.choir('choir', ch, t, s.bar(this)); s.sub('bass', ch[0] - 24, t, s.bar(this) * 0.5); }
      if ([0, 2, 3, 6, 8, 10, 11, 14].includes(k)) s.taiko('taiko', t, k === 0 || k === 8 ? 1 : 0.55, k % 2 ? 1.2 : 1);
      if (k % 2 === 0) s.bass('bass', ch[0] - 12, t, s.step(this) * 1.6);
      if ([0, 3, 6].includes(k) && bar % 2 === 0) s.brass('brass', ch, t, s.step(this) * (k === 6 ? 6 : 2.5));
      const arp = [0, 1, 2, 1][k % 4];
      s.pluck('pulse', ch[arp] + 24 + (k >= 8 ? 12 : 0), t, 0.8);
      if (k % 2 === 1) s.hat('perc', t, false);
      if (k === 4 || k === 12) s.rim('perc', t);
    }
  },
  cinematic: {
    bpm: 60, prog: [C.Dm, C.Bb, C.Eb, C.Dm], quant: 4,
    layers: { pad: () => 0.85, drone: () => 1, boom: () => 0.8 },
    play(s, step, t, ch, bar) {
      if (step % 16 === 0) { s.pad('pad', ch, t, s.bar(this) * 1.05, 600); s.drone('drone', ch[0] - 12, t, s.bar(this)); }
      if (step % 32 === 0) s.boom('boom', t);
    }
  },
  dawn: {
    bpm: 76, prog: [C.D, C.A, C.G, C.A], quant: 16,
    layers: { pad: () => 0.85, theme: () => 0.95, bells: () => 0.6, bass: () => 0.5 },
    play(s, step, t, ch, bar) {
      const k = step % 16;
      if (k === 0) { s.pad('pad', ch, t, s.bar(this) * 1.05, 1600); s.sub('bass', ch[0] - 12, t, s.bar(this)); }
      s.melody('theme', THEME_MAJOR, step, t, 'piano');
      if (k === 8 && s.rand() < 0.7) s.bell('bells', ch[(s.rand() * 3) | 0] + 36, t);
    }
  },
  death: {
    bpm: 50, prog: [C.Dm], quant: 4,
    layers: { pad: () => 1.1, drone: () => 1.1 },
    play(s, step, t, ch) {
      if (step % 16 === 0) { s.pad('pad', ch, t, s.bar(this) * 1.05, 450); s.drone('drone', ch[0] - 24, t, s.bar(this)); }
    }
  }
};

/* -------------------------------------------------------------------- */

export class Score {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} out music bus
   * @param {AudioNode} reverb send into the shared hall
   */
  constructor(ctx, out, reverb) {
    this.ctx = ctx;
    this.out = out;
    this.reverbIn = reverb;
    this.cues = new Map();
    this.current = null;
    this.pending = null;
    this.intensity = 0;
    this._i = 0;
    this._seed = 1;
    // a dotted-eighth echo for the plucked line
    this.echo = ctx.createDelay(2);
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.echo.connect(lp).connect(this.echoFb).connect(this.echo);
    this.echoOut = ctx.createGain();
    this.echoOut.gain.value = 0.5;
    lp.connect(this.echoOut).connect(out);
  }

  rand() {
    this._seed = (this._seed * 16807) % 2147483647;
    return (this._seed - 1) / 2147483646;
  }

  /* ---- cue management ------------------------------------------- */

  _make(name) {
    const def = CUES[name];
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);
    const layers = {};
    for (const key of Object.keys(def.layers)) {
      const g = ctx.createGain();
      g.gain.value = def.layers[key](this._i);
      g.connect(gain);
      layers[key] = { node: g, fn: def.layers[key], value: g.gain.value };
    }
    return { name, def, gain, layers, next: 0, n: 0, bpm: def.bpm, alive: true };
  }

  /** Ask for a cue; it starts on the next beat (fights) or bar (the rest). */
  set(name) {
    if (!CUES[name]) return;
    if (this.current?.name === name) { this.pending = null; return; }
    if (this.pending === name) return;
    this.pending = name;
    if (!this.current) this._switch((this._now ?? this.ctx.currentTime) + 0.05);
  }

  _switch(at) {
    const name = this.pending;
    this.pending = null;
    const old = this.current;
    if (old) {
      // fade from wherever its automation actually is at `at` (reading
      // .value would give "now", not `at`, and can cut the cue dead)
      holdAt(old.gain.gain, at, 1);
      old.gain.gain.linearRampToValueAtTime(0, at + 2.2);
      old.until = at + 2.4;
      this.fading = [...(this.fading ?? []), old];
    }
    let cue = this.cues.get(name);
    if (!cue || cue.until) {
      cue = this._make(name);
      this.cues.set(name, cue);
    }
    cue.next = at;
    cue.n = 0;
    holdAt(cue.gain.gain, at, 0.0001);
    cue.gain.gain.linearRampToValueAtTime(1, at + (old ? 1.6 : 0.8));
    this.current = cue;
  }

  step(cue) {
    return 60 / cue.bpm / 4;
  }

  bar(cue) {
    return (60 / cue.bpm) * 4;
  }

  level(key) {
    return this._cueNow?.layers[key]?.value ?? 0;
  }

  /** Schedule every cue that is sounding up to `until` (audio-clock seconds). */
  scheduleUntil(until) {
    const cues = [this.current, ...(this.fading ?? [])].filter(Boolean);
    for (const cue of cues) {
      while (cue.next < until) {
        if (cue.until && cue.next > cue.until) break;
        // a pending change waits for a quantised step of the current cue
        if (cue === this.current && this.pending && cue.n % (CUES[this.pending].quant <= 4 ? 4 : 16) === 0 && cue.n > 0) {
          this._switch(cue.next);
          return this.scheduleUntil(until);
        }
        const bar = Math.floor(cue.n / 16);
        const ch = cue.def.prog[bar % cue.def.prog.length];
        this._cueNow = cue;
        cue.def.play(this, cue.n, cue.next, ch, bar);
        cue.next += this.step(cue);
        cue.n++;
      }
    }
    if (this.fading) this.fading = this.fading.filter((c) => c.until > (this._now ?? this.ctx.currentTime));
  }

  /** @param {number} [now] audio-clock time — defaults to the context's (live play) */
  update(dt, now = this.ctx.currentTime) {
    // intensity: quick to rise, slow to fall
    const goal = this.intensity;
    this._i += (goal - this._i) * Math.min(1, dt * (goal > this._i ? 1.6 : 0.3));
    this._now = now;
    if (this.current) {
      for (const layer of Object.values(this.current.layers)) {
        const v = layer.fn(this._i);
        if (Math.abs(v - layer.value) > 0.01) {
          layer.value = v;
          layer.node.gain.setTargetAtTime(v, now, 0.5);
        }
      }
    }
    this.scheduleUntil(now + 0.25);
  }

  /* ---- stingers --------------------------------------------------- */

  stinger(kind, at = null) {
    const t = at ?? this.ctx.currentTime + 0.02;
    const out = this.out;
    const bus = { node: out, value: 1 };
    const temp = this._cueNow;
    this._cueNow = { layers: { st: bus } };
    if (kind === 'chapter') {
      this.taiko('st', t, 1.2, 0.8);
      this.taiko('st', t + 0.18, 0.8, 0.9);
      this.brass('st', C.Dm.map((m) => m - 12), t, 1.6);
      this.boom('st', t);
    } else if (kind === 'reveal') {
      this.boom('st', t);
      this.taiko('st', t, 1.4, 0.7);
      this.brass('st', [38, 39, 45], t, 2.8);
      this.choir('st', [50, 51, 57], t, 3);
    } else if (kind === 'victory') {
      this.taiko('st', t, 1.2, 0.8);
      this.brass('st', C.D, t, 3.5);
      this.pad('st', C.D, t, 5, 2400);
      this.bell('st', 86, t + 0.3);
      this.bell('st', 90, t + 0.6);
    } else if (kind === 'death') {
      this.pad('st', [50, 53, 56], t, 3, 500);
      this.sub('st', 26, t, 3);
    }
    this._cueNow = temp;
  }

  /* ---- instruments ------------------------------------------------- */

  _layer(key) {
    return this._cueNow?.layers[key];
  }

  _voice(key, time, dur, { attack = 0.01, peak = 0.2, release = null, reverb = 0.25 } = {}) {
    const layer = this._layer(key);
    if (!layer || layer.value < 0.01) return null;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + attack);
    const end = time + dur + (release ?? 0);
    if (release) {
      g.gain.setValueAtTime(peak, time + dur);
      g.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    }
    g.connect(layer.node);
    if (reverb > 0 && this.reverbIn) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverbIn);
    }
    return { g, end: Math.max(end, time + dur) + 0.05 };
  }

  _osc(type, freq, time, end, out, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.detune.value = detune;
    o.connect(out);
    o.start(time);
    o.stop(end);
    return o;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _noise(time, end, out) {
    if (!this._noiseBuf) {
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = b;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = true;
    s.connect(out);
    s.start(time, Math.random() * 0.5);
    s.stop(end);
    return s;
  }

  /** Two detuned saws per note, voiced over two octaves, swelling in. */
  pad(key, ch, time, dur, cutoff = 900) {
    const v = this._voice(key, time, dur, { attack: Math.min(1.4, dur * 0.4), peak: 0.05, release: 1.2, reverb: 0.55 });
    if (!v) return;
    const f = this._filter('lowpass', cutoff, 0.6);
    f.connect(v.g);
    for (const m of [...ch, ch[0] + 12, ch[1] + 12]) {
      this._osc('sawtooth', mtof(m + 12), time, v.end, f, -7);
      this._osc('sawtooth', mtof(m + 12), time, v.end, f, 7);
    }
  }

  drone(key, m, time, dur) {
    const v = this._voice(key, time, dur, { attack: 1.5, peak: 0.12, release: 1.5, reverb: 0.3 });
    if (!v) return;
    this._osc('sine', mtof(m), time, v.end, v.g);
    const f = this._filter('lowpass', 220, 2);
    f.connect(v.g);
    this._osc('sawtooth', mtof(m), time, v.end, f, 5);
  }

  /** The home theme, one note per entry, played on a music box or a piano. */
  melody(key, theme, step, time, voice) {
    const k = step % 64;
    for (const [s, m, len] of theme) {
      if (s !== k) continue;
      if (voice === 'box') this.box(key, m + 12, time, len);
      else this.piano(key, m, time, 1);
    }
  }

  box(key, m, time) {
    const v = this._voice(key, time, 2.2, { attack: 0.004, peak: 0.12, reverb: 0.6 });
    if (!v) return;
    this._osc('sine', mtof(m), time, v.end, v.g);
    const h = this.ctx.createGain();
    h.gain.value = 0.25;
    h.connect(v.g);
    this._osc('sine', mtof(m) * 3.01, time, v.end, h);
  }

  piano(key, m, time, vel = 0.8) {
    const v = this._voice(key, time, 2.6, { attack: 0.006, peak: 0.1 * vel, reverb: 0.5 });
    if (!v) return;
    const f = this._filter('lowpass', 2600, 0.5);
    f.connect(v.g);
    this._osc('triangle', mtof(m), time, v.end, f);
    this._osc('sine', mtof(m) * 2, time, v.end, f, 3);
  }

  bell(key, m, time) {
    const v = this._voice(key, time, 3.5, { attack: 0.003, peak: 0.05, reverb: 0.7 });
    if (!v) return;
    for (const [r, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
      const g = this.ctx.createGain();
      g.gain.value = a;
      g.connect(v.g);
      this._osc('sine', mtof(m) * r, time, v.end, g);
    }
  }

  pluck(key, m, time, vel = 1) {
    const v = this._voice(key, time, 0.28, { attack: 0.003, peak: 0.07 * vel, reverb: 0.2 });
    if (!v) return;
    const f = this._filter('lowpass', 3200, 1);
    f.connect(v.g);
    const e = this.ctx.createGain();
    e.gain.value = 0.35;
    v.g.connect(e).connect(this.echo);
    this.echo.delayTime.value = (60 / (this.current?.bpm ?? 120)) * 0.75;
    this._osc('triangle', mtof(m), time, v.end, f);
    this._osc('square', mtof(m), time, v.end, this._gainTo(f, 0.15));
  }

  _gainTo(dest, value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  bass(key, m, time, len) {
    const v = this._voice(key, time, len, { attack: 0.005, peak: 0.16, reverb: 0.05 });
    if (!v) return;
    const f = this._filter('lowpass', 700, 4);
    f.frequency.setValueAtTime(900, time);
    f.frequency.exponentialRampToValueAtTime(160, time + len);
    f.connect(v.g);
    this._osc('sawtooth', mtof(m), time, v.end, f);
    this._osc('square', mtof(m - 12), time, v.end, this._gainTo(f, 0.5));
  }

  sub(key, m, time, dur) {
    const v = this._voice(key, time, dur, { attack: 0.3, peak: 0.16, release: 0.8, reverb: 0 });
    if (!v) return;
    this._osc('sine', mtof(m), time, v.end, v.g);
  }

  taiko(key, time, vel = 1, pitch = 1) {
    const v = this._voice(key, time, 0.7, { attack: 0.002, peak: 0.42 * vel, reverb: 0.35 });
    if (!v) return;
    const o = this._osc('sine', 120 * pitch, time, v.end, v.g);
    o.frequency.exponentialRampToValueAtTime(42 * pitch, time + 0.3);
    const n = this._voice(key, time, 0.09, { attack: 0.001, peak: 0.22 * vel, reverb: 0.2 });
    if (n) {
      const f = this._filter('lowpass', 900, 0.8);
      f.connect(n.g);
      this._noise(time, n.end, f);
    }
  }

  rim(key, time) {
    const v = this._voice(key, time, 0.12, { attack: 0.001, peak: 0.12, reverb: 0.3 });
    if (!v) return;
    const f = this._filter('bandpass', 1900, 2.5);
    f.connect(v.g);
    this._noise(time, v.end, f);
    this._osc('triangle', 330, time, v.end, this._gainTo(v.g, 0.4));
  }

  hat(key, time, open = false) {
    const v = this._voice(key, time, open ? 0.22 : 0.05, { attack: 0.001, peak: 0.045, reverb: 0.1 });
    if (!v) return;
    const f = this._filter('highpass', 7500, 0.7);
    f.connect(v.g);
    this._noise(time, v.end, f);
  }

  /** Low brass: three detuned saws per note through a snapping filter. */
  brass(key, ch, time, len) {
    const v = this._voice(key, time, len, { attack: 0.03, peak: 0.07, release: 0.3, reverb: 0.45 });
    if (!v) return;
    const f = this._filter('lowpass', 400, 1.5);
    f.frequency.setValueAtTime(350, time);
    f.frequency.linearRampToValueAtTime(2200, time + 0.08);
    f.frequency.exponentialRampToValueAtTime(700, time + len);
    f.connect(v.g);
    for (const m of ch) for (const d of [-9, 0, 9]) this._osc('sawtooth', mtof(m), time, v.end, f, d);
  }

  /** A choir "ah": saws through two vowel formants, with vibrato. */
  choir(key, ch, time, dur) {
    const v = this._voice(key, time, dur, { attack: 0.9, peak: 0.08, release: 1.2, reverb: 0.7 });
    if (!v) return;
    const f1 = this._filter('bandpass', 730, 6);
    const f2 = this._filter('bandpass', 1090, 7);
    f1.connect(v.g);
    f2.connect(this._gainTo(v.g, 0.7));
    // a slow vibrato on every voice
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = this.ctx.createGain();
    depth.gain.value = 14;
    lfo.connect(depth);
    for (const m of [...ch, ch[0] + 12]) {
      for (const d of [-12, 12]) {
        const o = this._osc('sawtooth', mtof(m + 12), time, v.end, f1, d);
        o.connect(f2);
        depth.connect(o.detune);
      }
    }
    lfo.start(time);
    lfo.stop(v.end);
  }

  tremolo(key, m, time, dur) {
    const v = this._voice(key, time, dur, { attack: 0.8, peak: 0.06, release: 0.8, reverb: 0.6 });
    if (!v) return;
    const amp = this.ctx.createGain();
    amp.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 9;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(amp.gain);
    lfo.start(time);
    lfo.stop(v.end);
    const f = this._filter('lowpass', 3800, 0.7);
    f.connect(amp).connect(v.g);
    this._osc('sawtooth', mtof(m), time, v.end, f, -6);
    this._osc('sawtooth', mtof(m), time, v.end, f, 6);
  }

  thump(key, time, vel = 1) {
    const v = this._voice(key, time, 0.35, { attack: 0.002, peak: 0.3 * vel, reverb: 0.15 });
    if (!v) return;
    const o = this._osc('sine', 70, time, v.end, v.g);
    o.frequency.exponentialRampToValueAtTime(38, time + 0.25);
  }

  boom(key, time) {
    const v = this._voice(key, time, 3.2, { attack: 0.003, peak: 0.5, reverb: 0.6 });
    if (!v) return;
    const o = this._osc('sine', 58, time, v.end, v.g);
    o.frequency.exponentialRampToValueAtTime(30, time + 2.5);
    const n = this._voice(key, time, 1.4, { attack: 0.002, peak: 0.25, reverb: 0.6 });
    if (n) {
      const f = this._filter('lowpass', 260, 0.7);
      f.connect(n.g);
      this._noise(time, n.end, f);
    }
  }
}

/** A generated hall impulse: stereo noise under an exponential decay. */
export function makeImpulse(ctx, seconds = 2.8, decay = 3) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
