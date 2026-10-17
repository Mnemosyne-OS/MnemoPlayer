/**
 * bounceBars.ts — the numbers behind the little bouncing bars (doc 151 §11):
 * the classic « now playing » sign, under the player and as a visualizer look.
 *
 * Two sources, never confused:
 *  - `spectrum`: a song of the music folder heard through the analyser (or the
 *    computer's output sound): the 64 log bands are averaged into the bars, so
 *    the bars FOLLOW the music;
 *  - `indicator`: a YouTube video (its sound cannot be read from this page) or
 *    a song playing straight to the speakers: a smooth, randomised bounce
 *    driven by play / pause only. It says « music is playing », never « this
 *    is the spectrum ».
 *  - `idle`: nothing plays; the bars settle to rest and the loop stops.
 *
 * Pure: no DOM, no clock. The component owns the frame loop.
 */

export type BounceSource = 'spectrum' | 'indicator' | 'idle';

/** Height a bar keeps at rest, 0..1: low, but still a row of bars, never nothing. */
export const BOUNCE_REST = 0.12;

/** Which source drives the bars for this state of the player. */
export function bounceSource(s: { playing: boolean; kind: 'yt' | 'local' | null; outputOn: boolean; graphLive: boolean }): BounceSource {
  if (!s.playing || !s.kind) return 'idle';
  if (s.outputOn) return 'spectrum';
  if (s.kind === 'local' && s.graphLive) return 'spectrum';
  // A YouTube video, or a song playing straight (no Web Audio yet): we know it plays, not what it sounds like.
  return 'indicator';
}

// Per-bar rhythm, spread by the golden ratio so no two neighbours move together.
const PHI = 0.618033988749895;
const frac = (x: number) => x - Math.floor(x);

/**
 * The indicator's height for bar `i` of `count` at `tMs`, in [0.2, 1]: three
 * slow sines per bar at unrelated speeds, which never repeats in a way the eye
 * catches, and never jumps (it is continuous in t).
 */
export function indicatorLevel(i: number, count: number, tMs: number): number {
  const s = tMs / 1000;
  const a = frac(i * PHI + 0.11);
  const b = frac(i * PHI * 2 + 0.37);
  const c = frac(i * PHI * 3 + 0.71);
  const v =
    Math.sin(s * (5.1 + 3.3 * a) + a * 6.28) * 0.5 +
    Math.sin(s * (8.7 + 4.1 * b) + b * 6.28) * 0.3 +
    Math.sin(s * (2.3 + 1.7 * c) + c * 6.28) * 0.2;
  // the middle bars reach a little higher, the classic silhouette
  const centre = count > 1 ? 1 - Math.abs(i / (count - 1) - 0.5) * 0.5 : 1;
  const level = (0.55 + 0.45 * v) * (0.75 + 0.25 * centre);
  return Math.min(1, Math.max(0.2, level));
}

/**
 * The reduced-motion picture of « playing »: fixed, varied heights, so a still
 * row still reads as music and not as a frozen meter.
 */
export function stillLevel(i: number): number {
  return 0.35 + 0.55 * frac(i * PHI + 0.2);
}

/**
 * The 64 log bands averaged into `out.length` bars (0..1). The top bands
 * (above ~11 kHz) carry little of a song's energy: they are left out so the
 * last bars do not sit dead.
 */
export function foldToBars(bands: Float32Array, out: Float32Array): void {
  const used = Math.max(1, Math.round(bands.length * 0.86));
  const n = out.length;
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * used) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * used) / n));
    let sum = 0;
    for (let k = from; k < to; k++) sum += bands[k] ?? 0;
    // a light lift: an average flattens the music, the eye wants the beat
    out[b] = Math.min(1, Math.pow(sum / (to - from), 0.8) * 1.15);
  }
}

/**
 * One smoothing step, in place: a rise followed fast, a fall slower, a missing
 * target (`null`) falls to rest. Returns how far the bars still are from rest,
 * so the loop knows when to stop.
 */
export function stepBars(levels: Float32Array, target: Float32Array | null, dt: number): number {
  const rise = Math.min(1, dt / 45);
  const fall = Math.min(1, dt / 160);
  let away = 0;
  for (let i = 0; i < levels.length; i++) {
    const want = target ? Math.max(BOUNCE_REST, target[i] ?? 0) : BOUNCE_REST;
    const cur = levels[i] ?? BOUNCE_REST;
    let next = cur + (want - cur) * (want > cur ? rise : fall);
    if (!target && Math.abs(next - BOUNCE_REST) < 0.004) next = BOUNCE_REST;
    levels[i] = next;
    away += Math.abs(next - BOUNCE_REST);
  }
  return away;
}
