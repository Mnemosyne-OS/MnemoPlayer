/**
 * audioGraph.ts — the Web Audio graph behind the music folder's <audio>
 * (doc 151 §10): source → preamp → 10 bands → analyser → speakers.
 *
 * One graph for the window, created lazily the first time a local song starts
 * playing, closed when the sound panel (mounted for the life of the app)
 * unmounts. The <audio> element itself is never touched here: the player
 * keeps setting its volume and mute, the orb's duck included.
 *
 * Rules, each one a way the music goes silent if broken:
 *  - 🚨 an element is routed into the graph ONLY when the context RUNS. An
 *    element routed into a suspended context (autoplay policy: no gesture
 *    yet, e.g. a song started by voice) plays nothing, duck included. A
 *    blocked context leaves the element playing straight to the speakers,
 *    without spectrum or EQ, and the next click in the window retries.
 *  - 🚨 no gain node mirrors the volume. In Chromium the element's volume and
 *    mute are applied BEFORE the source node, so the duck already reaches the
 *    speakers through this chain; a mirrored gain would duck twice (0.15²).
 *    Believed from the spec and Chromium's source, not measured in the app.
 *  - an element can be routed once in its life (`createMediaElementSource`
 *    throws on a second call): a WeakSet remembers it. The player makes a new
 *    element per song, so each song gets its own source and the previous one
 *    is disconnected.
 *  - the context is never closed while the app runs: after `close()` Chromium
 *    does not hand a routed element's sound back to the speakers.
 */
import { bandType, dbToGain, EQ_BANDS, EQ_Q, headroomDb } from './eq';
import { BAND_COUNT, bandEdges, foldBands } from './spectrumBands';

export type GraphState = 'idle' | 'live' | 'blocked' | 'unavailable';

/** How long a resume may take before the context is said blocked. */
export const RESUME_TIMEOUT_MS = 1000;
export const FFT_SIZE = 2048;

interface Graph {
  ctx: AudioContext;
  pre: GainNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
  bins: Uint8Array;
  edges: Int32Array;
}

let makeContext: () => AudioContext | null = () => {
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  return Ctor ? new Ctor() : null;
};

let graph: Graph | null = null;
let state: GraphState = 'idle';
let gains: number[] = EQ_BANDS.map(() => 0);
const routed = new WeakSet<HTMLMediaElement>();
let current: { el: HTMLMediaElement; source: MediaElementAudioSourceNode } | null = null;
/** An element that started while the context was blocked: retried on the next gesture. */
let pending: HTMLMediaElement | null = null;
const listeners = new Set<() => void>();

function setState(next: GraphState): void {
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function getGraphState(): GraphState {
  return state;
}

export function subscribeGraph(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function build(): Graph | null {
  let ctx: AudioContext | null;
  try {
    ctx = makeContext();
  } catch (err) {
    console.warn('[youtube] no audio context, the music plays without spectrum or equalizer:', err);
    ctx = null;
  }
  if (!ctx) return null;
  const pre = ctx.createGain();
  const filters = EQ_BANDS.map((hz, i) => {
    const f = ctx.createBiquadFilter();
    f.type = bandType(i);
    f.frequency.value = hz;
    f.Q.value = EQ_Q;
    return f;
  });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.78;
  pre.connect(filters[0]!);
  for (let i = 1; i < filters.length; i++) filters[i - 1]!.connect(filters[i]!);
  filters[filters.length - 1]!.connect(analyser);
  analyser.connect(ctx.destination);
  ctx.onstatechange = () => {
    // Something else suspended a running context (the OS, a device change): the
    // routed song would go silent, so it is asked back at once.
    if (ctx.state === 'suspended' && current) ctx.resume().catch((err: unknown) => console.warn('[youtube] audio context could not resume:', err));
  };
  const g: Graph = { ctx, pre, filters, analyser, bins: new Uint8Array(analyser.frequencyBinCount), edges: bandEdges(BAND_COUNT, analyser.frequencyBinCount, ctx.sampleRate) };
  applyGains(g);
  return g;
}

function applyGains(g: Graph): void {
  g.filters.forEach((f, i) => { f.gain.value = gains[i] ?? 0; });
  g.pre.gain.value = dbToGain(headroomDb(gains));
}

/** The equalizer's curve, in dB per band. Kept even before the graph exists. */
export function setGains(next: readonly number[]): void {
  gains = EQ_BANDS.map((_, i) => next[i] ?? 0);
  if (graph) applyGains(graph);
}

async function running(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((resolve) => { timer = setTimeout(resolve, RESUME_TIMEOUT_MS); }),
    ]);
  } catch (err) {
    console.warn('[youtube] audio context refused to start:', err);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return (ctx.state as string) === 'running';
}

/** Routes a song's element through the graph. Answers what the graph now is. */
export async function attach(el: HTMLMediaElement): Promise<GraphState> {
  if (current?.el === el) return state;
  if (!graph) graph = build();
  const g = graph;
  if (!g) { setState('unavailable'); return state; }
  if (!(await running(g.ctx))) {
    pending = el;
    setState('blocked');
    return state;
  }
  if (routed.has(el)) return state; // routed earlier, still connected
  let source: MediaElementAudioSourceNode;
  try {
    source = g.ctx.createMediaElementSource(el);
  } catch (err) {
    console.warn('[youtube] this song could not be routed through the equalizer:', err);
    setState('unavailable');
    return state;
  }
  routed.add(el);
  if (current) {
    try { current.source.disconnect(); } catch (err) { console.warn('[youtube] previous song source already gone:', err); }
  }
  source.connect(g.pre);
  current = { el, source };
  pending = null;
  setState('live');
  return state;
}

/** A gesture in the window: a song that started while blocked gets its spectrum and EQ now. */
export async function retryPending(): Promise<GraphState> {
  const el = pending;
  if (!el || !el.isConnected || el.paused) return state;
  return attach(el);
}

/** True while a routed song is on screen and playing: the analyser hears it. */
export function localLive(): boolean {
  return state === 'live' && !!current && current.el.isConnected && !current.el.paused;
}

/** Folds the analyser into `out` (0..1 per band). False when nothing is heard. */
export function readBands(out: Float32Array): boolean {
  if (!graph || !localLive()) return false;
  graph.analyser.getByteFrequencyData(graph.bins);
  foldBands(graph.bins, graph.edges, out);
  return true;
}

/** The app is going away: the context is released. Never called while a song plays. */
export function closeGraph(): void {
  const g = graph;
  graph = null;
  current = null;
  pending = null;
  setState('idle');
  if (g) g.ctx.close().catch((err: unknown) => console.warn('[youtube] audio context did not close:', err));
}

/** Tests only. */
export function __setContextFactoryForTests(fn: () => AudioContext | null): void {
  makeContext = fn;
  graph = null;
  current = null;
  pending = null;
  state = 'idle';
  gains = EQ_BANDS.map(() => 0);
}
