/**
 * spectrumBands.ts — an analyser's linear FFT bins folded into BAND_COUNT
 * log-spaced bands, the way an ear hears them (doc 151 §10).
 *
 * A linear FFT gives the top octave half of its bins: drawn as is, the left
 * fifth of a visualizer would hold the whole song and the rest would shimmer
 * on cymbals. The host folds the computer's output sound the same way
 * (renderer/src/lib/outputSpectrum.ts), so both sources draw on the same scale.
 */

export const BAND_COUNT = 64;
export const BAND_MIN_HZ = 32;
export const BAND_MAX_HZ = 16_000;

/**
 * Start bin of each band, plus the end of the last one (length count + 1).
 * Every band holds at least one bin, so the low bands (narrower than a bin
 * at fftSize 2048) repeat a bin rather than read nothing.
 */
export function bandEdges(count: number, binCount: number, sampleRate: number): Int32Array {
  const edges = new Int32Array(count + 1);
  const hzPerBin = sampleRate / 2 / binCount;
  const top = Math.min(BAND_MAX_HZ, sampleRate / 2);
  for (let b = 0; b <= count; b++) {
    const hz = BAND_MIN_HZ * Math.pow(top / BAND_MIN_HZ, b / count);
    edges[b] = Math.min(binCount, Math.max(0, Math.round(hz / hzPerBin)));
  }
  for (let b = 1; b <= count; b++) {
    if (edges[b]! <= edges[b - 1]!) edges[b] = Math.min(binCount, edges[b - 1]! + 1);
  }
  return edges;
}

/** Folds `bins` (0..255) into `out` (0..1): the loudest bin of each band. Allocates nothing. */
export function foldBands(bins: Uint8Array, edges: Int32Array, out: Float32Array): void {
  const count = out.length;
  for (let b = 0; b < count; b++) {
    const from = edges[b]!;
    const to = Math.max(from + 1, edges[b + 1]!);
    let peak = 0;
    for (let i = from; i < to && i < bins.length; i++) if (bins[i]! > peak) peak = bins[i]!;
    out[b] = peak / 255;
  }
}
