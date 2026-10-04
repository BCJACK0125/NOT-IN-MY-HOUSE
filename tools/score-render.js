/**
 * Render the adaptive score offline (no game, no speakers), for measuring the
 * mix and for a listening preview.
 *
 *   const { renderScore, PLANS } = await import('./tools/score-render.js');
 *   const wavBase64 = await renderScore(PLANS.preview, 100);
 *
 * A plan is `(t) => ({ cue, i, stinger? })`, sampled every 50 ms.
 */
import { Score, makeImpulse } from '../src/game/Score.js';

export async function renderScore(plan, seconds, rate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  // the same chain as the game: music bus → master → glue → limiter
  const master = ctx.createGain();
  master.gain.value = 0.8;
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
  master.connect(glue).connect(limiter).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 2.8, 3);
  const wet = ctx.createGain();
  wet.gain.value = 0.8;
  reverb.connect(wet).connect(master);
  const music = ctx.createGain();
  music.gain.value = 0.62;
  music.connect(master);

  const score = new Score(ctx, music, reverb);
  const first = plan(0);
  score._i = first.i ?? 0;
  const fired = new Set();
  for (let t = 0; t < seconds; t += 0.05) {
    const s = plan(t);
    score.intensity = s.i ?? 0;
    if (s.cue) score.set(s.cue);
    if (s.stinger && !fired.has(s.stinger + s.at)) {
      fired.add(s.stinger + s.at);
      score.stinger(s.stinger, t);
    }
    score.update(0.05, t);
  }
  const buf = await ctx.startRendering();
  return toWav(buf);
}

function toWav(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i]));
    out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    o += 2;
  }
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const at = (cue, i) => () => ({ cue, i });

export const PLANS = {
  title: at('title', 0),
  explore: at('explore', 0),
  exploreTense: at('explore', 0.6),
  combatLow: at('combat', 0.2),
  combatHigh: at('combat', 1),
  bossP1: at('boss', 0.45),
  bossP2: at('boss', 1),
  cinematic: at('cinematic', 0),
  dawn: at('dawn', 0),
  death: at('death', 0),
  /** The game's arc in ~100 s. */
  preview: (t) => {
    if (t < 16) return { cue: 'title', i: 0 };
    if (t < 26) return { cue: 'cinematic', i: 0, stinger: t >= 16 && t < 16.1 ? 'chapter' : null, at: 16 };
    if (t < 38) return { cue: 'explore', i: t > 31 ? 0.6 : 0 };
    if (t < 60) return { cue: 'combat', i: Math.min(1, (t - 38) / 16) };
    if (t < 80) return { cue: 'boss', i: t > 70 ? 1 : 0.45, stinger: t >= 60 && t < 60.1 ? 'reveal' : null, at: 60 };
    return { cue: 'dawn', i: 0, stinger: t >= 80 && t < 80.1 ? 'victory' : null, at: 80 };
  }
};
