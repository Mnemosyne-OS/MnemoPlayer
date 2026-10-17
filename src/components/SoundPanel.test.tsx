/**
 * The sound panel on screen (doc 151 §10): the loop only runs while there is
 * something to draw, stops when the window hides and is cancelled on unmount;
 * a YouTube video gets the decorative ambience, never bars; the tiles are the
 * same store as the voice.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundPanel } from './SoundPanel';
import { vizMode } from './Visualizer';
import * as player from '../lib/player';
import { __resetSoundPrefsForTests, getSoundPrefs, setLook } from '../lib/soundPrefs';
import * as graph from '../lib/audioGraph';
import { __setContextFactoryForTests } from '../lib/audioGraph';
import { __resetOutputForTests } from '../lib/outputSpectrum';
import * as vizDraw from '../lib/vizDraw';

/** A 2D context that records nothing and throws nothing. */
function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} };
  return new Proxy({}, {
    get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient' ? () => grad : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
const cancelled: number[] = [];

beforeEach(() => {
  window.localStorage.clear();
  __resetSoundPrefsForTests();
  __resetOutputForTests();
  player.__resetPlayerForTests();
  __setContextFactoryForTests(() => null);
  frames = new Map();
  nextId = 1;
  cancelled.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx());
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id); frames.delete(id); });
  if (typeof globalThis.Path2D === 'undefined') vi.stubGlobal('Path2D', class { rect() {} roundRect() {} moveTo() {} lineTo() {} quadraticCurveTo() {} closePath() {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Runs the frames queued now (not the ones they queue). */
function tick(t: number) {
  const now = [...frames.entries()];
  frames.clear();
  act(() => { for (const [, cb] of now) cb(t); });
}

describe('what the canvas shows', () => {
  it('a YouTube video without the output spectrum gets the ambience, a song gets the spectrum, nothing playing is idle', () => {
    expect(vizMode({ playing: true, kind: 'yt', outputOn: false, graphLive: false })).toBe('ambient');
    expect(vizMode({ playing: true, kind: 'yt', outputOn: true, graphLive: false })).toBe('spectrum');
    expect(vizMode({ playing: true, kind: 'local', outputOn: false, graphLive: true })).toBe('spectrum');
    // A song playing straight (context blocked): nothing heard, so no loop burning.
    expect(vizMode({ playing: true, kind: 'local', outputOn: false, graphLive: false })).toBe('idle');
    expect(vizMode({ playing: false, kind: 'local', outputOn: true, graphLive: true })).toBe('idle');
  });

  it('on YouTube a canvas look draws the ambience and never the bars, and says so', () => {
    setLook('bars');
    const ambient = vi.spyOn(vizDraw, 'drawAmbient');
    const look = vi.spyOn(vizDraw, 'drawLook');
    player.playQueue([{ kind: 'yt', videoId: 'aaaaaaaaaaa', title: 'A' }], 0, { kind: 'single' });
    render(<SoundPanel />);
    tick(16); tick(33);
    expect(ambient).toHaveBeenCalled();
    expect(look).not.toHaveBeenCalled();
    expect(screen.getByRole('note')).toHaveAttribute('title', expect.stringMatching(/cannot be read/));
  });
});

describe('the loop never burns for nothing', () => {
  it('nothing playing: one settling pass, then no frame is asked', () => {
    render(<SoundPanel />);
    tick(16);
    expect(frames.size).toBe(0);
  });

  it('a hidden window cancels the loop, a visible one restarts it', () => {
    player.playQueue([{ kind: 'local', path: 'C:/m/a.mp3', title: 'A' }], 0, { kind: 'music' });
    vi.spyOn(graph, 'getGraphState').mockReturnValue('live'); // the song is routed: there is sound to draw
    render(<SoundPanel />);
    tick(16);
    expect(frames.size).toBe(1);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(0);
    vis.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(1);
  });

  it('unmount cancels the frame in flight', () => {
    player.playQueue([{ kind: 'local', path: 'C:/m/a.mp3', title: 'A' }], 0, { kind: 'music' });
    vi.spyOn(graph, 'getGraphState').mockReturnValue('live'); // the song is routed: there is sound to draw
    const { unmount } = render(<SoundPanel />);
    tick(16);
    const pending = [...frames.keys()];
    unmount();
    expect(cancelled).toEqual(expect.arrayContaining(pending));
  });

  it('the visualizer switched off draws nothing at all', () => {
    player.playQueue([{ kind: 'local', path: 'C:/m/a.mp3', title: 'A' }], 0, { kind: 'music' });
    vi.spyOn(graph, 'getGraphState').mockReturnValue('live'); // the song is routed: there is sound to draw
    render(<SoundPanel />);
    fireEvent.click(screen.getByLabelText('Hide the visualizer'));
    expect(document.querySelector('canvas')).toBeNull();
    expect(getSoundPrefs().vizOn).toBe(false);
  });
});

describe('the tiles are the store', () => {
  it('a preset tile and a look icon change what the voice reads', () => {
    render(<SoundPanel />);
    fireEvent.click(screen.getByText('Jazz'));
    expect(getSoundPrefs().preset).toBe('jazz');
    fireEvent.click(screen.getByLabelText('Radial'));
    expect(getSoundPrefs().look).toBe('radial');
  });

  it('the output switch is not drawn where the host does not offer it', () => {
    render(<SoundPanel />);
    expect(screen.queryByLabelText(/computer’s output sound/)).toBeNull();
  });
});
