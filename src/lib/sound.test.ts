/**
 * The sound panel's rules (doc 151 §10): the equalizer's numbers, the graph
 * that must never silence a song, the viewer's remembered choices, the voice
 * actions, and the output spectrum that only takes numbers from the host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampGain, EQ_BANDS, headroomDb, normalizeGains, presetGains, presetOf } from './eq';
import { __setContextFactoryForTests, attach, closeGraph, getGraphState, localLive, readBands, retryPending, setGains } from './audioGraph';
import { bandEdges, foldBands, BAND_COUNT } from './spectrumBands';
import { __resetSoundPrefsForTests, getSoundPrefs, nextLook, onStorage, parsePrefs, setBand, setLook, setPreset, STORAGE_KEY } from './soundPrefs';
import { setEqualizerAction, setVisualizerAction } from './soundAgent';
import { __resetOutputForTests, FRESH_MS, getOutput, onHostMessage, readOutputBands, SPECTRUM_MESSAGE } from './outputSpectrum';
import * as player from './player';

// ── A fake Web Audio, enough to see what is created and connected ─────────
class Param { value = 0; }
class Node {
  connections: unknown[] = [];
  connect(n: unknown) { this.connections.push(n); return n; }
  disconnect() { this.connections = []; }
}
class FakeCtx {
  state: string;
  sampleRate = 48_000;
  destination = new Node();
  gains: Array<Node & { gain: Param }> = [];
  filters: Array<Node & { type: string; frequency: Param; Q: Param; gain: Param }> = [];
  sources: Array<{ el: HTMLMediaElement; node: Node }> = [];
  closed = false;
  onstatechange: (() => void) | null = null;
  resumeTo: string;
  constructor(state: string, resumeTo = state) { this.state = state; this.resumeTo = resumeTo; }
  createGain() { const g = Object.assign(new Node(), { gain: new Param() }); this.gains.push(g); return g; }
  createBiquadFilter() { const f = Object.assign(new Node(), { type: '', frequency: new Param(), Q: new Param(), gain: new Param() }); this.filters.push(f); return f; }
  createAnalyser() {
    return Object.assign(new Node(), {
      fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 1024,
      getByteFrequencyData: (out: Uint8Array) => out.fill(200),
    });
  }
  createMediaElementSource(el: HTMLMediaElement) {
    if (this.sources.some((s) => s.el === el)) throw new Error('InvalidStateError');
    const node = new Node();
    this.sources.push({ el, node });
    return node;
  }
  resume() { this.state = this.resumeTo; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}

function playingAudio(): HTMLAudioElement {
  const el = document.createElement('audio');
  document.body.appendChild(el);
  Object.defineProperty(el, 'paused', { value: false, configurable: true });
  return el;
}

let ctx: FakeCtx;
const useCtx = (state: string, resumeTo?: string) => {
  ctx = new FakeCtx(state, resumeTo);
  __setContextFactoryForTests(() => ctx as unknown as AudioContext);
};

beforeEach(() => {
  window.localStorage.clear();
  __resetSoundPrefsForTests();
  player.__resetPlayerForTests();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('the equalizer’s numbers', () => {
  it('ten bands, presets named back from their gains, a moved slider is custom', () => {
    expect(EQ_BANDS).toHaveLength(10);
    expect(presetOf(presetGains('jazz'))).toBe('jazz');
    const g = presetGains('jazz');
    g[3] = 6;
    expect(presetOf(g)).toBe('custom');
  });

  it('a gain is bounded, and an unreadable one is 0 dB, never a guess', () => {
    expect(clampGain(40)).toBe(12);
    expect(clampGain(-40)).toBe(-12);
    expect(clampGain(NaN)).toBe(0);
    expect(clampGain('6')).toBe(0);
    expect(normalizeGains([3])).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('a boost takes half of itself back before the bands; a cut never raises the level', () => {
    expect(headroomDb(presetGains('bass'))).toBe(-3.5);
    expect(headroomDb(presetGains('flat'))).toBe(0);
    expect(headroomDb([-6, -6, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });
});

describe('the bands a spectrum is folded into', () => {
  it('log-spaced, each band at least one bin, all inside the FFT', () => {
    const e = bandEdges(BAND_COUNT, 1024, 48_000);
    expect(e).toHaveLength(BAND_COUNT + 1);
    for (let b = 1; b <= BAND_COUNT; b++) expect(e[b]!).toBeGreaterThan(e[b - 1]!);
    expect(e[BAND_COUNT]!).toBeLessThanOrEqual(1024);
    // The lowest band is far narrower than the highest: an ear's scale, not the FFT's.
    expect(e[1]! - e[0]!).toBeLessThan(e[BAND_COUNT]! - e[BAND_COUNT - 1]!);
  });

  it('a band is the loudest of its bins, 0..1', () => {
    const bins = new Uint8Array(1024);
    bins[2] = 255;
    const out = new Float32Array(BAND_COUNT);
    foldBands(bins, bandEdges(BAND_COUNT, 1024, 48_000), out);
    expect(Math.max(...out)).toBe(1);
    expect(out[BAND_COUNT - 1]).toBe(0);
  });
});

describe('the graph never silences a song', () => {
  it('a blocked context (no gesture yet, a song started by voice) does NOT route the element', async () => {
    useCtx('suspended', 'suspended');
    vi.useFakeTimers();
    const el = playingAudio();
    const p = attach(el);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBe('blocked');
    vi.useRealTimers();
    expect(ctx.sources).toHaveLength(0);
    expect(localLive()).toBe(false);
  });

  it('the next gesture routes the song that waited', async () => {
    useCtx('suspended', 'running');
    const el = playingAudio();
    ctx.resume = () => Promise.resolve(); // first try: still blocked
    vi.useFakeTimers();
    const p = attach(el);
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    vi.useRealTimers();
    expect(getGraphState()).toBe('blocked');
    ctx.resume = () => { ctx.state = 'running'; return Promise.resolve(); };
    expect(await retryPending()).toBe('live');
    expect(ctx.sources.map((s) => s.el)).toEqual([el]);
  });

  it('a running context routes it through preamp → 10 bands → analyser → speakers, and nothing mirrors the volume', async () => {
    useCtx('running');
    const el = playingAudio();
    el.volume = 0.12; // the orb's duck, set by the player
    expect(await attach(el)).toBe('live');
    expect(ctx.filters.map((f) => f.type)).toEqual(['lowshelf', ...Array(8).fill('peaking'), 'highshelf']);
    // ONE gain node, the preamp: a second one copying el.volume would duck twice.
    expect(ctx.gains).toHaveLength(1);
    expect(el.volume).toBe(0.12);
    expect(ctx.sources[0]!.node.connections[0]).toBe(ctx.gains[0]);
    const out = new Float32Array(BAND_COUNT);
    expect(readBands(out)).toBe(true);
    expect(out[10]).toBeCloseTo(200 / 255);
  });

  it('a new song gets its own source and the previous one is let go; the same element is never routed twice', async () => {
    useCtx('running');
    const a = playingAudio();
    const b = playingAudio();
    await attach(a);
    await attach(a);
    await attach(b);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]!.node.connections).toEqual([]);
  });

  it('the curve reaches the filters, before or after the graph exists', async () => {
    useCtx('running');
    setGains(presetGains('bass'));
    await attach(playingAudio());
    expect(ctx.filters.map((f) => f.gain.value)).toEqual(presetGains('bass'));
    expect(ctx.gains[0]!.gain.value).toBeCloseTo(Math.pow(10, -3.5 / 20));
    setGains(presetGains('flat'));
    expect(ctx.gains[0]!.gain.value).toBe(1);
  });

  it('no Web Audio at all: the song plays as before, said unavailable', async () => {
    __setContextFactoryForTests(() => null);
    expect(await attach(playingAudio())).toBe('unavailable');
  });

  it('closing releases the context', async () => {
    useCtx('running');
    await attach(playingAudio());
    closeGraph();
    expect(ctx.closed).toBe(true);
    expect(getGraphState()).toBe('idle');
  });
});

describe('what this viewer chose is remembered, and a broken storage changes nothing else', () => {
  it('look, on/off and curve survive a reload', () => {
    setLook('radial');
    setPreset('jazz');
    setBand(0, 9);
    __resetSoundPrefsForTests();
    expect(getSoundPrefs()).toMatchObject({ look: 'radial', vizOn: true, preset: 'custom' });
    expect(getSoundPrefs().gains[0]).toBe(9);
  });

  it('an unreadable stored value is the defaults, field by field', () => {
    window.localStorage.setItem(STORAGE_KEY, '{nope');
    __resetSoundPrefsForTests();
    expect(getSoundPrefs()).toMatchObject({ look: 'bounce', vizOn: true, preset: 'flat' });
    expect(parsePrefs({ look: 'disco', vizOn: false, gains: 'x' })).toMatchObject({ look: 'bounce', vizOn: false, preset: 'flat' });
  });

  it('a `bars` saved before the bouncing bars existed was the old default, not a choice: it becomes bounce; one chosen since is kept', () => {
    // every save wrote the look, so a preset click alone stored `bars`
    expect(parsePrefs({ look: 'bars', vizOn: true }).look).toBe('bounce');
    expect(parsePrefs({ look: 'radial', vizOn: true }).look).toBe('radial');
    expect(parsePrefs({ v: 2, look: 'bars', vizOn: true }).look).toBe('bars');
    setLook('bars');
    __resetSoundPrefsForTests();
    expect(getSoundPrefs().look).toBe('bars');
  });

  it('a change made in another window of MnemoPlayer is read again (the storage event)', () => {
    expect(getSoundPrefs().look).toBe('bounce');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, look: 'wave', vizOn: true, gains: [] }));
    onStorage(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(getSoundPrefs().look).toBe('wave');
  });

  it('a storage that throws keeps the choice for the session', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(setLook('wave').look).toBe('wave');
    expect(getSoundPrefs().look).toBe('wave');
  });
});

describe('the voice', () => {
  it('« mets l’égaliseur en mode jazz » is the Jazz tile', () => {
    const r = setEqualizerAction({ preset: 'Jazz' });
    expect(r).toMatchObject({ preset: 'jazz', appliesTo: 'music folder' });
    expect(getSoundPrefs().preset).toBe('jazz');
  });

  it('on a YouTube video the answer says the equalizer shapes the music folder only', () => {
    player.playQueue([{ kind: 'yt', videoId: 'aaaaaaaaaaa', title: 'A' }], 0, { kind: 'single' });
    expect(setEqualizerAction({ preset: 'rock' }).say).toMatch(/not YouTube/);
    player.playQueue([{ kind: 'local', path: 'C:/m/a.mp3', title: 'A' }], 0, { kind: 'music' });
    expect(setEqualizerAction({ preset: 'rock' }).say).not.toMatch(/YouTube/);
  });

  it('an unknown preset is refused with the ones that exist', () => {
    expect(() => setEqualizerAction({ preset: 'disco' })).toThrow(/^NO_PRESET: .*jazz/);
  });

  it('« change l’effet » is the next look, « coupe le visualiseur » turns it off, a wrong look is named', () => {
    const next = nextLook();
    expect(setVisualizerAction({ change: 'next' })).toMatchObject({ on: true, look: next });
    expect(setVisualizerAction({ change: 'off' })).toMatchObject({ on: false });
    expect(getSoundPrefs().vizOn).toBe(false);
    expect(setVisualizerAction({ look: 'wave' })).toMatchObject({ on: true, look: 'wave' });
    expect(setVisualizerAction({ look: 'Bounce' })).toMatchObject({ on: true, look: 'bounce' });
    expect(() => setVisualizerAction({ look: 'disco' })).toThrow(/^NO_LOOK/);
    expect(() => setVisualizerAction({})).toThrow(/^BAD_ARG/);
  });
});

describe('the output spectrum takes numbers, from the host only', () => {
  let t = 1000;
  beforeEach(() => { t = 1000; __resetOutputForTests(() => t); });

  const fromHost = (data: unknown, source: Window | null = window.parent) =>
    onHostMessage(new MessageEvent('message', { data, source }));

  it('ignores another window, keeps only numbers, and goes stale fast', () => {
    __resetOutputForTests(() => t, 'on');
    const out = new Float32Array(BAND_COUNT);
    // A cartridge-side window that is not the host: ignored.
    fromHost({ type: SPECTRUM_MESSAGE, bins: Array(BAND_COUNT).fill(255) }, {} as Window);
    expect(readOutputBands(out)).toBe(false);
    // The host: numbers kept (0..255 → 0..1), anything else read as 0.
    fromHost({ type: SPECTRUM_MESSAGE, bins: [255, 'loud', 1e9, -4, ...Array(BAND_COUNT - 4).fill(51)], audio: 'never read' });
    expect(readOutputBands(out)).toBe(true);
    expect([out[0], out[1], out[2], out[3]]).toEqual([1, 0, 1, 0]);
    expect(out[10]).toBeCloseTo(0.2);
    // The host went quiet: the bars must not freeze on the last frame.
    t += FRESH_MS + 1;
    expect(readOutputBands(out)).toBe(false);
  });

  it('a stop from the host turns the switch off and says why', () => {
    fromHost({ type: SPECTRUM_MESSAGE, stopped: true, reason: 'FRAME_GONE' });
    __resetOutputForTests(() => t, 'on');
    fromHost({ type: SPECTRUM_MESSAGE, stopped: true, reason: 'FRAME_GONE' });
    expect(getOutput()).toEqual({ status: 'off', error: 'FRAME_GONE' });
    expect(FRESH_MS).toBeLessThan(1000);
  });
});
