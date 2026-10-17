/**
 * vizDraw.ts — the visualizer's looks, drawn on a 2D canvas (doc 151 §10).
 *
 * Each look draws ONE frame from the smoothed bands (0..1). Built for 60 fps:
 * every look fills or strokes a single path with one shadow, so the glow is
 * computed once per frame and not once per bar (a per-bar `shadowBlur` is what
 * drops a canvas to 20 fps). Nothing here allocates per bar.
 *
 * `drawAmbient` is NOT a spectrum: three soft lights drifting, driven only by
 * whether something plays. It is what a YouTube video gets when the output
 * spectrum is off, because the page cannot hear the frame's sound, and its
 * shape (no bars, no curve) keeps it from being read as the music's.
 */
import type { CanvasLook } from './soundPrefs';

export interface Palette {
  a: string;
  b: string;
  c: string;
  cap: string;
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in device pixels. */
  w: number;
  h: number;
  dpr: number;
  bands: Float32Array;
  peaks: Float32Array;
  palette: Palette;
}

function sweep(f: Frame, x0: number, x1: number): CanvasGradient {
  const g = f.ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, f.palette.a);
  g.addColorStop(0.5, f.palette.b);
  g.addColorStop(1, f.palette.c);
  return g;
}

/** The loudness of the lowest eighth of the bands: what makes a core pulse. */
export function bassOf(bands: Float32Array): number {
  const n = Math.max(1, Math.floor(bands.length / 8));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += bands[i] ?? 0;
  return sum / n;
}

function drawBars(f: Frame): void {
  const { ctx, w, h, dpr, bands, peaks } = f;
  const n = bands.length;
  const slot = w / n;
  const barW = Math.max(1, slot * 0.68);
  const base = h * 0.76;
  const maxH = h * 0.7;
  const radius = Math.min(barW / 2, 6 * dpr);
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const bh = Math.max(2 * dpr, (bands[i] ?? 0) * maxH);
    const x = i * slot + (slot - barW) / 2;
    if (typeof path.roundRect === 'function') path.roundRect(x, -bh, barW, bh, [radius, radius, 1, 1]);
    else path.rect(x, -bh, barW, bh);
  }
  const fill = sweep(f, 0, w);
  ctx.save();
  ctx.translate(0, base);
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = f.palette.b;
  ctx.shadowBlur = 18 * dpr;
  ctx.fillStyle = fill;
  ctx.fill(path);
  // The floor's reflection: the same bars, flattened and faint, no glow.
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.18;
  ctx.scale(1, -0.32);
  ctx.fill(path);
  ctx.restore();
  // Peak caps, falling slower than the bars.
  ctx.save();
  ctx.fillStyle = f.palette.cap;
  ctx.globalAlpha = 0.9;
  const capH = Math.max(1.5, 2 * dpr);
  for (let i = 0; i < n; i++) {
    const p = peaks[i] ?? 0;
    if (p < 0.02) continue;
    ctx.fillRect(i * slot + (slot - barW) / 2, base - p * maxH - capH - 3 * dpr, barW, capH);
  }
  ctx.restore();
}

function drawRadial(f: Frame): void {
  const { ctx, w, h, dpr, bands } = f;
  const n = bands.length;
  const cx = w / 2;
  const cy = h / 2;
  const side = Math.min(w, h);
  const bass = bassOf(bands);
  const r0 = side * 0.2 * (1 + bass * 0.22);
  const maxLen = side * 0.27;
  // The core: a light that breathes with the bass.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0 * 1.1);
  core.addColorStop(0, f.palette.cap);
  core.addColorStop(0.35, f.palette.b);
  core.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25 + bass * 0.55;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r0 * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Spokes, mirrored left and right so the lows sit at the top and the highs meet at the bottom.
  const path = new Path2D();
  for (let side2 = -1; side2 <= 1; side2 += 2) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + side2 * ((i + 0.5) / n) * Math.PI;
      const len = Math.max(1.5 * dpr, (bands[i] ?? 0) * maxLen);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      path.moveTo(cx + cos * r0, cy + sin * r0);
      path.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5 * dpr, ((Math.PI * 2 * r0) / (n * 2)) * 0.55);
  ctx.strokeStyle = typeof ctx.createConicGradient === 'function' ? conic(f, cx, cy) : sweep(f, cx - side / 2, cx + side / 2);
  ctx.shadowColor = f.palette.b;
  ctx.shadowBlur = 16 * dpr;
  ctx.stroke(path);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, r0 - 4 * dpr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function conic(f: Frame, cx: number, cy: number): CanvasGradient {
  const g = f.ctx.createConicGradient(-Math.PI / 2, cx, cy);
  g.addColorStop(0, f.palette.a);
  g.addColorStop(0.25, f.palette.b);
  g.addColorStop(0.5, f.palette.c);
  g.addColorStop(0.75, f.palette.b);
  g.addColorStop(1, f.palette.a);
  return g;
}

/** A ribbon: the spectrum as one smooth curve, mirrored above and below the middle line. */
function ribbon(f: Frame, values: Float32Array, scale: number): Path2D {
  const { w, h } = f;
  const n = values.length;
  const mid = h / 2;
  const amp = h * 0.44 * scale;
  const xs = (i: number) => (i / (n - 1)) * w;
  const path = new Path2D();
  path.moveTo(0, mid);
  for (const dir of [-1, 1]) {
    // The top half runs left to right, the bottom half comes back right to left.
    const at = (k: number) => (dir === -1 ? k : n - 1 - k);
    let px = xs(at(0));
    let py = mid + dir * (values[at(0)] ?? 0) * amp;
    path.lineTo(px, py);
    for (let k = 1; k < n; k++) {
      const i = at(k);
      const x = xs(i);
      const y = mid + dir * (values[i] ?? 0) * amp;
      path.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x;
      py = y;
    }
    path.lineTo(px, mid);
  }
  path.closePath();
  return path;
}

function drawWave(f: Frame): void {
  const { ctx, w, h, dpr } = f;
  const fill = sweep(f, 0, w);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // The slow peaks behind, faint: depth.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = fill;
  ctx.fill(ribbon(f, f.peaks, 1.05));
  // The live ribbon, glowing.
  const live = ribbon(f, f.bands, 1);
  ctx.globalAlpha = 0.55;
  ctx.shadowColor = f.palette.b;
  ctx.shadowBlur = 22 * dpr;
  ctx.fill(live);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeStyle = f.palette.cap;
  ctx.stroke(live);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, h / 2 - 0.5 * dpr, w, 1 * dpr);
  ctx.restore();
}

export function drawLook(look: CanvasLook, f: Frame): void {
  f.ctx.clearRect(0, 0, f.w, f.h);
  if (look === 'radial') drawRadial(f);
  else if (look === 'wave') drawWave(f);
  else drawBars(f);
}

/**
 * The decorative ambience: three lights drifting on slow Lissajous paths.
 * `energy` (0..1) is the only input and comes from play/pause, never sound.
 */
export function drawAmbient(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, energy: number, palette: Palette): void {
  ctx.clearRect(0, 0, w, h);
  const side = Math.min(w, h);
  const colors = [palette.a, palette.b, palette.c];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const s = t / 1000;
    const x = w / 2 + Math.sin(s * (0.13 + k * 0.05) + k * 2.1) * w * 0.28;
    const y = h / 2 + Math.cos(s * (0.11 + k * 0.04) + k * 1.3) * h * 0.22;
    const r = side * (0.32 + 0.06 * Math.sin(s * 0.6 + k)) * (0.75 + 0.25 * energy);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, colors[k]!);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.18 + 0.22 * energy;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/**
 * One smoothing step, in place: a rise is followed fast, a fall slowly, and
 * the peaks fall slower still. Returns the frame's total energy, so the loop
 * knows when everything has settled and it can stop.
 */
export function smoothStep(target: Float32Array | null, bands: Float32Array, peaks: Float32Array, dt: number): number {
  const rise = Math.min(1, dt / 40);
  const fall = Math.pow(0.88, dt / 16.7);
  const peakFall = 0.0045 * (dt / 16.7);
  let energy = 0;
  for (let i = 0; i < bands.length; i++) {
    const want = target ? target[i] ?? 0 : 0;
    const cur = bands[i] ?? 0;
    const next = want > cur ? cur + (want - cur) * rise : Math.max(want, cur * fall);
    bands[i] = next < 0.002 ? 0 : next;
    const p = peaks[i] ?? 0;
    peaks[i] = next >= p ? next : Math.max(0, p - peakFall);
    energy += bands[i]! + peaks[i]!;
  }
  return energy;
}
