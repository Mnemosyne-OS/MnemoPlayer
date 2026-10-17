/**
 * eq.ts — the equalizer's numbers (doc 151 §10): ten bands, the presets, and
 * the headroom that keeps a boost from clipping.
 *
 * Pure on purpose: the Web Audio graph (audioGraph.ts) applies these numbers,
 * the screen and the voice only choose them.
 *
 * ⚠️ The equalizer acts on the songs of the music folder ONLY. A YouTube video
 * plays in a cross-origin frame whose sound this page can neither read nor
 * filter, and nothing here pretends otherwise.
 */

/** Centre frequencies, Hz (ISO octave bands). The first is a low shelf, the last a high shelf. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MAX_DB = 12;
/** Width of the eight peaking bands: one octave. */
export const EQ_Q = 1.41;

export const EQ_PRESETS = ['flat', 'bass', 'vocal', 'electronic', 'jazz', 'rock', 'classical', 'acoustic'] as const;
export type EqPreset = (typeof EQ_PRESETS)[number];
/** A preset the person moved a slider away from. Never asked for by voice: it is a state, not a choice. */
export type EqChoice = EqPreset | 'custom';

const PRESET_GAINS: Record<EqPreset, readonly number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  vocal: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0],
  electronic: [5, 4, 1, 0, -2, 1, 1, 2, 4, 5],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  classical: [3, 2, 1, 0, 0, 0, -1, -1, 1, 2],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
};

export const isPreset = (v: unknown): v is EqPreset => typeof v === 'string' && (EQ_PRESETS as readonly string[]).includes(v);

export function presetGains(p: EqPreset): number[] {
  return [...PRESET_GAINS[p]];
}

/** One band's gain, bounded and rounded to half a dB. Anything unreadable is 0 dB, never a guess. */
export function clampGain(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.round(Math.min(EQ_MAX_DB, Math.max(-EQ_MAX_DB, v)) * 2) / 2;
}

/** Exactly EQ_BANDS.length gains; a short or broken list is filled with 0 dB. */
export function normalizeGains(v: unknown): number[] {
  const src = Array.isArray(v) ? v : [];
  return EQ_BANDS.map((_, i) => clampGain(src[i]));
}

/** The preset these gains ARE, or 'custom'. */
export function presetOf(gains: readonly number[]): EqChoice {
  return EQ_PRESETS.find((p) => PRESET_GAINS[p].every((g, i) => g === gains[i])) ?? 'custom';
}

/**
 * Gain in dB applied BEFORE the bands: half of the biggest boost, taken back.
 * A +7 dB bass boost on a mastered song clips; the preamp keeps the peak in
 * range and the curve's shape intact. A cut never raises the level.
 */
export function headroomDb(gains: readonly number[]): number {
  const boost = Math.max(0, ...gains);
  return boost === 0 ? 0 : -boost / 2;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** The filter type of a band: shelves at the two ends, peaks in between. */
export function bandType(i: number): BiquadFilterType {
  if (i === 0) return 'lowshelf';
  if (i === EQ_BANDS.length - 1) return 'highshelf';
  return 'peaking';
}
