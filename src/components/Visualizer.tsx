/**
 * Visualizer — the canvas that moves with the music (doc 151 §10).
 *
 * What it draws, frame by frame, from the most faithful source available:
 *  1. the computer's output sound, when the person switched it on (host
 *     loopback, numbers only) — YouTube included;
 *  2. the music folder's song, through the equalizer's analyser;
 *  3. for a YouTube video without (1): the decorative AMBIENCE, never bars,
 *     because the frame's sound cannot be heard from this page;
 *  4. nothing playing: the last frame settles to zero and the loop STOPS.
 *
 * The rAF loop runs only while there is something to draw: it stops when the
 * music stops and has settled, when the window is hidden, and on unmount
 * (cancelled). Under `prefers-reduced-motion` the spectrum is drawn at
 * 8 frames a second and the ambience is one still frame.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getGraphState, readBands, subscribeGraph } from '../lib/audioGraph';
import { readOutputBands, useOutput } from '../lib/outputSpectrum';
import * as player from '../lib/player';
import { BAND_COUNT } from '../lib/spectrumBands';
import type { CanvasLook } from '../lib/soundPrefs';
import { drawAmbient, drawLook, smoothStep, type Palette } from '../lib/vizDraw';
import { prefersReducedMotion } from '../lib/motion';
import { getPeerGraph, readPeerBands, subscribePeer } from '../lib/peerSound';

/** Frame spacing under prefers-reduced-motion. */
export const REDUCED_FRAME_MS = 125;

const FALLBACK: Palette = { a: '#3fa66a', b: '#2fc6d6', c: '#8a6bff', cap: '#ffffff' };

function paletteOf(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  // A colour the canvas cannot parse makes addColorStop THROW inside the frame
  // and kills the loop: anything CSS does not call a colour takes the fallback.
  const ok = (c: string) => typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports('color', c);
  const v = (name: string, fb: string) => {
    const c = css.getPropertyValue(name).trim();
    return c && ok(c) ? c : fb;
  };
  return { a: v('--viz-a', FALLBACK.a), b: v('--viz-b', FALLBACK.b), c: v('--viz-c', FALLBACK.c), cap: v('--viz-cap', FALLBACK.cap) };
}

export type VizMode = 'spectrum' | 'ambient' | 'idle';

/** What the canvas shows for this state of the player (the per-frame source can still fall back to idle). */
export function vizMode(s: { playing: boolean; kind: 'yt' | 'local' | null; outputOn: boolean; graphLive: boolean }): VizMode {
  if (!s.playing || !s.kind) return 'idle';
  if (s.outputOn) return 'spectrum';
  if (s.kind === 'yt') return 'ambient';
  // A song playing straight (no gesture yet, no Web Audio): nothing to hear, so no loop.
  return s.graphLive ? 'spectrum' : 'idle';
}

export function Visualizer({ look, label }: { look: CanvasLook; label: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // Kept across mode changes, so a pause lets the bars FALL instead of vanishing.
  const levels = useRef({ bands: new Float32Array(BAND_COUNT), peaks: new Float32Array(BAND_COUNT) });
  const s = player.usePlayer();
  const out = useOutput();
  const graphState = useSyncExternalStore(subscribeGraph, getGraphState);
  // In the exploded view the song may play in another window: its graph and bands arrive by the channel.
  const peerGraph = useSyncExternalStore(subscribePeer, getPeerGraph);
  const kind = player.current(s)?.kind ?? null;
  const mode = vizMode({ playing: s.playing, kind, outputOn: out.status === 'on', graphLive: graphState === 'live' || peerGraph === 'live' });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = el.getContext('2d');
    } catch (err) {
      console.warn('[youtube] no 2D canvas, the visualizer stays dark:', err);
    }
    if (!ctx) return undefined;
    const c2d = ctx;
    const reduced = prefersReducedMotion();
    const target = new Float32Array(BAND_COUNT);
    const { bands, peaks } = levels.current;
    let palette = paletteOf(el);
    let dpr = 1;
    let raf: number | null = null;
    let last = 0;
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      palette = paletteOf(el);
    };

    const frame = (t: number) => {
      raf = null;
      if (hidden) return;
      const dt = last ? Math.min(100, t - last) : 16.7;
      if (reduced && last && t - last < REDUCED_FRAME_MS) { raf = requestAnimationFrame(frame); return; }
      last = t;
      if (mode === 'ambient') {
        drawAmbient(c2d, el.width, el.height, reduced ? 0 : t, 1, palette);
        if (!reduced) raf = requestAnimationFrame(frame);
        return;
      }
      const heard = mode === 'spectrum' && (readOutputBands(target) || readBands(target) || readPeerBands(target));
      const energy = smoothStep(heard ? target : null, bands, peaks, dt);
      drawLook(look, { ctx: c2d, w: el.width, h: el.height, dpr, bands, peaks, palette });
      // Keep drawing while sound comes in or the last frame is still falling; then stop.
      if (mode === 'spectrum' || energy > 0) raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (raf === null && !hidden) { last = 0; raf = requestAnimationFrame(frame); }
    };
    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (hidden && raf !== null) { cancelAnimationFrame(raf); raf = null; }
      else kick();
    };

    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { resize(); kick(); }) : null;
    ro?.observe(el);
    document.addEventListener('visibilitychange', onVisibility);
    // In idle this is one settling pass from wherever the bars were: the loop stops itself at zero.
    kick();

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [look, mode, graphState, peerGraph]);

  return (
    <div className={`yt-viz${mode === 'ambient' ? ' ambient' : ''}`}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
