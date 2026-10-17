/**
 * player.ts — what is playing, for the whole window (doc 151 §3).
 *
 * One store, read by the screen's controls AND by the voice handlers, so a
 * spoken « pause » and the ❚❚ button call the SAME function and the person
 * sees it happen. The two players (the visible YouTube frame, the <audio> of
 * the music folder) only FOLLOW this store: they never decide what plays.
 */
import { useSyncExternalStore } from 'react';
import type { Item } from './library';

export type QueueSource =
  | { kind: 'playlist'; name: string }
  | { kind: 'search'; query: string }
  | { kind: 'music' }
  | { kind: 'channel' }
  | { kind: 'single' };

export interface PlayerState {
  queue: Item[];
  /** -1 when nothing is loaded. */
  index: number;
  playing: boolean;
  /** 0..100 — the PERSON's volume. Never lowered by the duck: see `ducked`. */
  volume: number;
  muted: boolean;
  from: QueueSource | null;
  /** The last refusal of a player (NOT_EMBEDDABLE, NOT_FOUND, READ_FAILED…), cleared by the next item. */
  error: string | null;
  /** Seconds, as the player last reported them; null = not known yet. */
  position: number | null;
  duration: number | null;
  /** The orb is listening or speaking: the players play at DUCK_RATIO of `volume`. */
  ducked: boolean;
  /**
   * Seconds to start the current item at, once: set when this window takes
   * over what another window was playing (the exploded view, doc 151 §13),
   * cleared by the next item.
   */
  resumeAt: number | null;
}

const EMPTY: PlayerState = { queue: [], index: -1, playing: false, volume: 80, muted: false, from: null, error: null, position: null, duration: null, ducked: false, resumeAt: null };

/**
 * What a control asks the player, as it travels to the window that plays
 * (doc 151 §13). In the window that plays, `forward` is null and every
 * function below applies its change here; in any other window of the
 * exploded view it is set, and the SAME functions send the command instead:
 * the buttons and the voice never know which window plays.
 */
export type PlayerCommand =
  | { op: 'playQueue'; items: Item[]; start: number; from: QueueSource }
  | { op: 'play' }
  | { op: 'pause' }
  | { op: 'next' }
  | { op: 'previous' }
  | { op: 'setVolume'; volume: number }
  | { op: 'setMuted'; muted: boolean };

let forward: ((cmd: PlayerCommand) => void) | null = null;

/** Set by the sync link: non-null while ANOTHER window plays. */
export function setForward(fn: ((cmd: PlayerCommand) => void) | null): void {
  forward = fn;
}

export function isRemote(): boolean {
  return forward !== null;
}

let state: PlayerState = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function getPlayer(): PlayerState {
  return state;
}

export function current(s: PlayerState = state): Item | null {
  return s.index >= 0 ? s.queue[s.index] ?? null : null;
}

export function subscribePlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribePlayer, getPlayer);
}

/**
 * What the window that plays says it plays (sync link). Everything but this
 * window's own `ducked`: the orb ducks each window from its own host signal.
 */
export function applyPeer(peer: Omit<PlayerState, 'ducked' | 'resumeAt'>, resumeAt: number | null = null): void {
  set({ ...peer, resumeAt });
}

/** The one-shot start position was used by a player. */
export function resumed(): void {
  if (state.resumeAt !== null) set({ resumeAt: null });
}

/** Starts a list at one of its items. An empty list plays nothing and says so. */
export function playQueue(items: Item[], start: number, from: QueueSource): Item {
  if (!items.length) throw new Error('NOTHING_TO_PLAY');
  const index = Math.min(Math.max(0, Math.floor(start)), items.length - 1);
  if (forward) { forward({ op: 'playQueue', items: [...items], start: index, from }); return items[index]!; }
  set({ queue: [...items], index, playing: true, from, error: null, position: null, duration: null, resumeAt: null });
  return items[index]!;
}

/** Resumes what is loaded. NOTHING_TO_PLAY when nothing is. */
export function play(): Item {
  const it = current();
  if (!it) throw new Error('NOTHING_TO_PLAY');
  if (forward) { forward({ op: 'play' }); return it; }
  set({ playing: true });
  return it;
}

/** Plays the current item again after a failure (« Réessayer »): the error goes, the clock restarts. */
export function retry(): void {
  if (!current()) return;
  if (forward) { forward({ op: 'play' }); return; }
  set({ playing: true, error: null, position: null });
}

export function pause(): void {
  if (forward) { forward({ op: 'pause' }); return; }
  set({ playing: false });
}

export function toggle(): void {
  if (state.playing) pause();
  else play();
}

/** The next item; at the end of the list it stops (no wrap: the person did not ask for a loop). */
export function next(): Item | null {
  if (state.index < 0) throw new Error('NOTHING_TO_PLAY');
  const last = state.index + 1 >= state.queue.length;
  if (forward) { forward({ op: 'next' }); return last ? null : state.queue[state.index + 1] ?? null; }
  if (last) {
    set({ playing: false });
    return null;
  }
  set({ index: state.index + 1, playing: true, error: null, position: null, duration: null, resumeAt: null });
  return current();
}

export function previous(): Item {
  if (state.index < 0) throw new Error('NOTHING_TO_PLAY');
  const index = Math.max(0, state.index - 1);
  if (forward) { forward({ op: 'previous' }); return state.queue[index]!; }
  set({ index, playing: true, error: null, position: null, duration: null, resumeAt: null });
  return current()!;
}

export const clampVolume = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));
/** One spoken « louder » / « quieter » step. */
export const VOLUME_STEP = 15;

export function setVolume(v: number): number {
  const volume = clampVolume(v);
  if (forward) { forward({ op: 'setVolume', volume }); return volume; }
  set({ volume, muted: volume === 0 ? state.muted : false });
  return volume;
}

/** Share of the person's volume kept while the orb listens or speaks: the music stays, under the voice. */
export const DUCK_RATIO = 0.15;

/**
 * The orb opens its microphone or speaks (true), or is done (false). Only the
 * flag moves: `volume` keeps the person's value, so the release brings back
 * exactly what they had, including a change they made during the duck.
 */
export function setDucked(ducked: boolean): void {
  if (state.ducked === ducked) return; // the host repeats itself: a level, not an event
  set({ ducked });
}

/** The volume the players actually apply, 0..100. */
export function effectiveVolume(s: PlayerState = state): number {
  return s.ducked ? clampVolume(s.volume * DUCK_RATIO) : s.volume;
}

export function setMuted(muted: boolean): void {
  if (forward) { forward({ op: 'setMuted', muted }); return; }
  set({ muted });
}

/** A player reached the end of its item. */
export function ended(): void {
  next();
}

/** A player could not play the current item: said on screen, the list stops there. */
export function failed(code: string): void {
  set({ error: code, playing: false });
}

export function progress(position: number | null, duration: number | null): void {
  if (position === state.position && duration === state.duration) return;
  set({ position, duration });
}

/** Tests only. */
export function __resetPlayerForTests(next: Partial<PlayerState> = {}): void {
  forward = null;
  state = { ...EMPTY, ...next };
}
