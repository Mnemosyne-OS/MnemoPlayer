/**
 * The little bouncing bars (doc 151 §11): a playing sign on YouTube, the
 * music's own bands on a song that is heard, rest when paused — and a frame
 * loop that only runs while something moves.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BounceBars } from './BounceBars';
import * as graph from '../lib/audioGraph';
import { BOUNCE_REST, bounceSource, foldToBars, indicatorLevel, stepBars, stillLevel } from '../lib/bounceBars';
import { __resetOutputForTests } from '../lib/outputSpectrum';
import { __resetPeerSoundForTests, setPeerBands, setPeerGraph } from '../lib/peerSound';
import * as player from '../lib/player';
import { BAND_COUNT } from '../lib/spectrumBands';

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
const cancelled: number[] = [];
let reduced = false;

beforeEach(() => {
  player.__resetPlayerForTests();
  __resetOutputForTests();
  __resetPeerSoundForTests();
  frames = new Map();
  nextId = 1;
  cancelled.length = 0;
  reduced = false;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id); frames.delete(id); });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tick(t: number) {
  const now = [...frames.entries()];
  frames.clear();
  act(() => { for (const [, cb] of now) cb(t); });
}

const heights = () => [...document.querySelectorAll('.yt-bounce span')].map((s) => Number(/scaleY\(([\d.]+)\)/.exec((s as HTMLElement).style.transform)?.[1] ?? NaN));
const yt = () => player.playQueue([{ kind: 'yt', videoId: 'aaaaaaaaaaa', title: 'A' }], 0, { kind: 'single' });
const song = () => player.playQueue([{ kind: 'local', path: 'C:/m/a.mp3', title: 'A' }], 0, { kind: 'music' });

describe('which source drives the bars', () => {
  it('YouTube is a playing indicator, a heard song is its spectrum, a song playing straight is the indicator, paused is idle', () => {
    expect(bounceSource({ playing: true, kind: 'yt', outputOn: false, graphLive: false })).toBe('indicator');
    expect(bounceSource({ playing: true, kind: 'yt', outputOn: true, graphLive: false })).toBe('spectrum');
    expect(bounceSource({ playing: true, kind: 'local', outputOn: false, graphLive: true })).toBe('spectrum');
    expect(bounceSource({ playing: true, kind: 'local', outputOn: false, graphLive: false })).toBe('indicator');
    expect(bounceSource({ playing: false, kind: 'local', outputOn: true, graphLive: true })).toBe('idle');
    expect(bounceSource({ playing: true, kind: null, outputOn: false, graphLive: false })).toBe('idle');
  });
});

describe('the numbers', () => {
  it('the indicator stays in its range, never jumps, and neighbours do not move together', () => {
    for (let t = 0; t < 5000; t += 16) {
      for (let i = 0; i < 12; i++) {
        const v = indicatorLevel(i, 12, t);
        expect(v).toBeGreaterThanOrEqual(0.2);
        expect(v).toBeLessThanOrEqual(1);
        expect(Math.abs(indicatorLevel(i, 12, t + 16) - v)).toBeLessThan(0.25);
      }
    }
    const a = [0, 1, 2, 3].map((i) => indicatorLevel(i, 12, 1234));
    expect(new Set(a.map((x) => x.toFixed(3))).size).toBe(4);
    expect(stillLevel(0)).not.toBe(stillLevel(1));
  });

  it('a band average follows the music: loud lows make the first bars tall, silence leaves them at zero', () => {
    const bands = new Float32Array(BAND_COUNT);
    for (let k = 0; k < 8; k++) bands[k] = 1;
    const out = new Float32Array(12);
    foldToBars(bands, out);
    expect(out[0]).toBeGreaterThan(0.9);
    expect(out[11]).toBe(0);
    foldToBars(new Float32Array(BAND_COUNT), out);
    expect([...out].every((x) => x === 0)).toBe(true);
  });

  it('without a target the bars fall to rest and say so with zero', () => {
    const lv = new Float32Array(5).fill(1);
    let away = 1;
    for (let i = 0; i < 400 && away > 0; i++) away = stepBars(lv, null, 16.7);
    expect(away).toBe(0);
    expect([...lv].every((x) => x === Math.fround(BOUNCE_REST))).toBe(true);
  });
});

describe('the loop never burns for nothing', () => {
  it('YouTube playing: the bars bounce and keep asking for frames', () => {
    yt();
    render(<BounceBars count={8} />);
    tick(16); tick(200); tick(400);
    expect(frames.size).toBe(1);
    expect(new Set(heights().map((h) => h.toFixed(2))).size).toBeGreaterThan(1);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Playing');
  });

  it('a pause lets the bars fall, then the loop stops', () => {
    yt();
    render(<BounceBars count={8} />);
    tick(16); tick(300);
    act(() => { player.pause(); });
    let t = 400;
    for (let i = 0; i < 400 && frames.size; i++) tick((t += 16));
    expect(frames.size).toBe(0);
    expect(heights().every((h) => Math.abs(h - BOUNCE_REST) < 0.001)).toBe(true);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Paused');
  });

  it('nothing playing: no frame at all after the first settling pass', () => {
    render(<BounceBars count={8} />);
    tick(16);
    expect(frames.size).toBe(0);
  });

  it('unmount cancels the frame in flight, and a hidden window cancels the loop', () => {
    yt();
    const { unmount } = render(<BounceBars count={8} />);
    tick(16);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(0);
    vis.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const pending = [...frames.keys()];
    expect(pending.length).toBe(1);
    unmount();
    expect(cancelled).toEqual(expect.arrayContaining(pending));
  });

  it('reduced motion: no loop, a still row of varied heights while playing', () => {
    reduced = true;
    yt();
    render(<BounceBars count={6} />);
    expect(frames.size).toBe(0);
    expect(heights()).toEqual([0, 1, 2, 3, 4, 5].map((i) => Number(stillLevel(i).toFixed(3))));
  });
});

describe('a heard song drives the bars with its own bands', () => {
  it('the analyser of this window', () => {
    song();
    vi.spyOn(graph, 'getGraphState').mockReturnValue('live');
    const read = vi.spyOn(graph, 'readBands').mockImplementation((out) => { out.fill(0); for (let k = 0; k < 6; k++) out[k] = 1; return true; });
    render(<BounceBars count={8} />);
    for (let t = 16; t < 600; t += 16) tick(t);
    expect(read).toHaveBeenCalled();
    const h = heights();
    expect(h[0]).toBeGreaterThan(0.8);
    expect(h[7]).toBeLessThan(0.2);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'The bars follow the music');
  });

  it('the Player window’s bands, in another window of the exploded view', () => {
    song();
    setPeerGraph('live');
    render(<BounceBars count={8} />);
    const b = Array.from({ length: BAND_COUNT }, (_, k) => (k < 6 ? 255 : 0));
    for (let t = 16; t < 600; t += 16) { setPeerBands(b); tick(t); }
    expect(heights()[0]).toBeGreaterThan(0.8);
    expect(heights()[7]).toBeLessThan(0.2);
  });
});
