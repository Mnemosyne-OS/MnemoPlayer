/**
 * soundPrefs.ts — how THIS viewer likes the sound shown and shaped
 * (doc 151 §10): the visualizer's look, whether it is on, the equalizer's
 * curve. A comfort, so it lives in localStorage (try/catch: a private window
 * or a blocked storage simply starts from the defaults), never in the
 * durable state the host keeps.
 *
 * One store for the window, read by the panel AND by the voice handlers, so
 * « mets l'égaliseur en mode jazz » and the Jazz tile change the same thing.
 */
import { useSyncExternalStore } from 'react';
import { isPreset, normalizeGains, presetGains, presetOf, type EqChoice, type EqPreset } from './eq';

/** `bounce` first: the little bouncing bars Tony asked for (doc 151 §11) are the default and the first icon. */
export const VIZ_LOOKS = ['bounce', 'bars', 'radial', 'wave'] as const;
export type VizLook = (typeof VIZ_LOOKS)[number];
/** The looks drawn on the canvas; `bounce` is DOM bars (BounceBars). */
export type CanvasLook = Exclude<VizLook, 'bounce'>;
export const isLook = (v: unknown): v is VizLook => typeof v === 'string' && (VIZ_LOOKS as readonly string[]).includes(v);

export interface SoundPrefs {
  look: VizLook;
  vizOn: boolean;
  gains: number[];
  preset: EqChoice;
}

export const STORAGE_KEY = 'mnemo-youtube:sound';

const DEFAULTS: SoundPrefs = { look: 'bounce', vizOn: true, gains: presetGains('flat'), preset: 'flat' };

/**
 * The version written with the prefs. Before 2 the default look was `bars`
 * and every save wrote it, chosen or not (a click on a preset tile saved the
 * look too): a stored `bars` without a version is read as « never chosen » and
 * becomes the new default. A look chosen after that carries `v: 2` and is kept.
 */
export const PREFS_VERSION = 2;

/** What a stored value says, field by field: an unreadable field takes its default, the others are kept. */
export function parsePrefs(raw: unknown): SoundPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS, gains: [...DEFAULTS.gains] };
  const r = raw as Record<string, unknown>;
  const gains = normalizeGains(r.gains);
  const old = r.v !== PREFS_VERSION;
  return {
    look: isLook(r.look) && !(old && r.look === 'bars') ? r.look : DEFAULTS.look,
    vizOn: typeof r.vizOn === 'boolean' ? r.vizOn : DEFAULTS.vizOn,
    gains,
    preset: presetOf(gains),
  };
}

function read(): SoundPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('[youtube] sound settings unreadable, defaults used:', err);
    return parsePrefs(null);
  }
}

let prefs: SoundPrefs | null = null;
const listeners = new Set<() => void>();

export function getSoundPrefs(): SoundPrefs {
  if (!prefs) prefs = read();
  return prefs;
}

function set(patch: Partial<SoundPrefs>): SoundPrefs {
  const next = { ...getSoundPrefs(), ...patch };
  next.preset = presetOf(next.gains);
  prefs = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: PREFS_VERSION, look: next.look, vizOn: next.vizOn, gains: next.gains }));
  } catch (err) {
    // A comfort, not a promise: the choice holds for this session and says why it will not survive.
    console.warn('[youtube] sound settings not remembered:', err);
  }
  listeners.forEach((fn) => fn());
  return next;
}

/**
 * Another window of MnemoPlayer (the exploded view, doc 151 §13) changed the
 * prefs: the browser tells every other window of the same origin with a
 * `storage` event, and this one re-reads them. That is how a curve moved in the
 * Sound window reaches the graph of the window that plays.
 */
export function onStorage(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  prefs = read();
  listeners.forEach((fn) => fn());
}

let watching = false;
function subscribe(fn: () => void): () => void {
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    window.addEventListener('storage', onStorage);
  }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(subscribe, getSoundPrefs);
}

/** A non-React reader (the graph host) that must follow every change, local or from another window. */
export function subscribeSoundPrefs(fn: () => void): () => void {
  return subscribe(fn);
}

export function setLook(look: VizLook): SoundPrefs {
  return set({ look, vizOn: true });
}

/** The look after this one, in the order of the icons. */
export function nextLook(cur: VizLook = getSoundPrefs().look): VizLook {
  return VIZ_LOOKS[(VIZ_LOOKS.indexOf(cur) + 1) % VIZ_LOOKS.length]!;
}

export function setVizOn(vizOn: boolean): SoundPrefs {
  return set({ vizOn });
}

export function setPreset(p: EqPreset): SoundPrefs {
  if (!isPreset(p)) throw new Error('NO_PRESET');
  return set({ gains: presetGains(p) });
}

export function setBand(i: number, db: number): SoundPrefs {
  const gains = [...getSoundPrefs().gains];
  if (i < 0 || i >= gains.length) return getSoundPrefs();
  gains[i] = db;
  return set({ gains: normalizeGains(gains) });
}

/** Tests only. */
export function __resetSoundPrefsForTests(): void {
  prefs = null;
}
