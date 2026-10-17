/**
 * peerSound.ts — the sound of ANOTHER window of MnemoPlayer (doc 151 §13, the
 * exploded view): when the Sound window is not the one playing, the player
 * window sends it its graph state and its 64 bands over the sync channel, and
 * the visualizer and the bars read them here.
 *
 * Bands are numbers only, and they go stale fast: past FRESH_MS without a new
 * frame nothing is drawn from them (a closed player window never leaves the
 * bars standing).
 */
import type { GraphState } from './audioGraph';
import { BAND_COUNT } from './spectrumBands';

export const PEER_FRESH_MS = 400;

let graph: GraphState | null = null;
const bands = new Float32Array(BAND_COUNT);
let bandsAt = -Infinity;
let now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const listeners = new Set<() => void>();

/** The player window's graph state, or null when no other window speaks. */
export function getPeerGraph(): GraphState | null {
  return graph;
}

export function subscribePeer(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setPeerGraph(next: GraphState | null): void {
  if (next === graph) return;
  graph = next;
  listeners.forEach((fn) => fn());
}

/** A frame of bands from the player window, already read (0..255 integers). */
export function setPeerBands(values: readonly number[]): void {
  for (let i = 0; i < BAND_COUNT; i++) bands[i] = (values[i] ?? 0) / 255;
  bandsAt = now();
}

/** The last fresh frame into `out`; false when there is none. */
export function readPeerBands(out: Float32Array): boolean {
  if (now() - bandsAt > PEER_FRESH_MS) return false;
  out.set(bands.subarray(0, out.length));
  return true;
}

/** Tests only. */
export function __resetPeerSoundForTests(clock?: () => number): void {
  graph = null;
  bandsAt = -Infinity;
  bands.fill(0);
  if (clock) now = clock;
}
