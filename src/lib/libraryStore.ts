/**
 * libraryStore.ts — one library for the whole window (playlists, music folder,
 * remembered choices), read once, written as CHANGES one after the other.
 *
 * Same rules as MnemoBreach's profileStore, for the same reasons:
 *  - nothing is saved before the first read answered (a save before it would
 *    write an empty library over the one the person has);
 *  - a write is a change applied to the library as it is when its turn comes,
 *    so two writes in flight (a voice « add this to Jazz » while a click
 *    renames) never erase each other;
 *  - a failed or refused write keeps what the screen had and says why.
 */
import { useSyncExternalStore } from 'react';
import { call, hasHost } from './host';
import { EMPTY_LIBRARY, normalizeLibrary, type Change, type Library } from './library';

export type LibrarySnapshot =
  | { status: 'loading'; library: Library }
  | { status: 'error'; library: Library }
  | { status: 'ready'; library: Library };

const BROWSER_KEY = 'mnemo-youtube:library';
let snap: LibrarySnapshot = { status: 'loading', library: EMPTY_LIBRARY };
const listeners = new Set<() => void>();
let started = false;

function publish(next: LibrarySnapshot): void {
  snap = next;
  listeners.forEach((fn) => fn());
}

export function getLibrarySnapshot(): LibrarySnapshot {
  return snap;
}

/** The host answers an envelope `{ state, updatedAt }`; an empty store is null. */
function stateOf(answer: unknown): unknown {
  return answer && typeof answer === 'object' && 'state' in answer ? (answer).state : null;
}

async function readLibrary(): Promise<Library> {
  if (hasHost()) return normalizeLibrary(stateOf(await call<unknown>('state.get')));
  try {
    const raw = window.localStorage.getItem(BROWSER_KEY);
    return normalizeLibrary(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('[youtube] browser library unreadable:', err instanceof Error ? err.message : String(err));
    return normalizeLibrary(null);
  }
}

async function writeLibrary(lib: Library): Promise<void> {
  if (hasHost()) {
    await call('state.set', { state: lib });
    return;
  }
  window.localStorage.setItem(BROWSER_KEY, JSON.stringify(lib));
}

/** Reads the saved library once per window. */
export function startLibrary(): void {
  if (started) return;
  started = true;
  readLibrary()
    .then((library) => publish({ status: 'ready', library }))
    .catch((err: unknown) => {
      console.warn('[youtube] library load failed:', err instanceof Error ? err.message : String(err));
      publish({ status: 'error', library: normalizeLibrary(null) });
    });
}

let onWritten: ((lib: Library) => void) | null = null;

/** The sync link (doc 151 §13): a library this window saved goes to the other windows of the exploded view. */
export function setLibraryWrittenListener(fn: ((lib: Library) => void) | null): void {
  onWritten = fn;
}

/**
 * A library another window saved. Re-normalised like any read; taken only once
 * this window has read its own (before, a write here could not happen anyway).
 * A write queued here applies to it when its turn comes, so neither is lost
 * unless the two windows write in the same instant (then the last save wins).
 */
export function adoptLibrary(raw: unknown): void {
  if (snap.status !== 'ready' || !raw || typeof raw !== 'object') return;
  publish({ status: 'ready', library: normalizeLibrary(raw) });
}

export type WriteResult = { ok: true; library: Library } | { ok: false; code: string };

let queue: Promise<unknown> = Promise.resolve();

/**
 * Applies `change` to the library as it is when this write's turn comes, then
 * saves. NOT_READY before the first read, the model's own refusal (FULL,
 * DUPLICATE…) as it is, WRITE_FAILED when the host refused the save.
 */
export function updateLibrary(change: (current: Library) => Change): Promise<WriteResult> {
  const run = async (): Promise<WriteResult> => {
    if (snap.status !== 'ready') return { ok: false, code: 'NOT_READY' };
    const res = change(snap.library);
    if (!res.ok) return res;
    try {
      await writeLibrary(res.library);
      publish({ status: 'ready', library: res.library });
      onWritten?.(res.library);
      return { ok: true, library: res.library };
    } catch (err) {
      console.warn('[youtube] library save failed:', err instanceof Error ? err.message : String(err));
      return { ok: false, code: 'WRITE_FAILED' };
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

export function useLibrary(): LibrarySnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getLibrarySnapshot);
}

/** Tests only. */
export function __resetLibraryForTests(next: LibrarySnapshot = { status: 'loading', library: EMPTY_LIBRARY }): void {
  started = false;
  onWritten = null;
  snap = next;
  queue = Promise.resolve();
}
