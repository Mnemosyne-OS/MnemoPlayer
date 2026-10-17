/**
 * folds.ts — which sections of MnemoPlayer this viewer folded, and which
 * panels they closed (doc 151 §12). A comfort: localStorage, read in a
 * try/catch, a broken storage simply starts with everything open.
 *
 * Shared by every window of the cartridge (the exploded view, doc 151 §13):
 * a `storage` event from another window re-reads it.
 */
import { useSyncExternalStore } from 'react';

export const FOLDS_KEY = 'mnemo-youtube:folds';

/** The panels that can be CLOSED (and reopened from an icon), not only folded. */
export const CLOSABLE = ['sound', 'queue'] as const;
export type Closable = (typeof CLOSABLE)[number];

export interface Folds {
  /** section id → folded */
  folded: Record<string, boolean>;
  closed: Closable[];
}

const EMPTY: Folds = { folded: {}, closed: [] };
const isClosable = (v: unknown): v is Closable => typeof v === 'string' && (CLOSABLE as readonly string[]).includes(v);

/** A stored value, field by field; anything unreadable is « open ». */
export function parseFolds(raw: unknown): Folds {
  if (!raw || typeof raw !== 'object') return { folded: {}, closed: [] };
  const r = raw as Record<string, unknown>;
  const folded: Record<string, boolean> = {};
  if (r.folded && typeof r.folded === 'object') {
    for (const [k, v] of Object.entries(r.folded as Record<string, unknown>)) {
      if (/^[a-z][a-z0-9-]{0,40}$/.test(k) && v === true) folded[k] = true;
    }
  }
  const closed = Array.isArray(r.closed) ? [...new Set(r.closed.filter(isClosable))] : [];
  return { folded, closed };
}

function read(): Folds {
  try {
    const raw = window.localStorage.getItem(FOLDS_KEY);
    return parseFolds(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('[youtube] folded sections unreadable, all open:', err);
    return { ...EMPTY };
  }
}

let folds: Folds | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function getFolds(): Folds {
  if (!folds) folds = read();
  return folds;
}

function write(next: Folds): void {
  folds = next;
  try {
    window.localStorage.setItem(FOLDS_KEY, JSON.stringify(next));
  } catch (err) {
    // A comfort: the fold holds for this session and says why it will not survive.
    console.warn('[youtube] folded sections not remembered:', err);
  }
  emit();
}

export function isFolded(id: string, f: Folds = getFolds()): boolean {
  return f.folded[id] === true;
}

export function setFolded(id: string, folded: boolean): void {
  const cur = getFolds();
  const next = { ...cur.folded };
  if (folded) next[id] = true;
  else delete next[id];
  write({ ...cur, folded: next });
}

export function isClosed(id: Closable, f: Folds = getFolds()): boolean {
  return f.closed.includes(id);
}

export function setClosed(id: Closable, closed: boolean): void {
  const cur = getFolds();
  const rest = cur.closed.filter((c) => c !== id);
  write({ ...cur, closed: closed ? [...rest, id] : rest });
}

let watching = false;
function onStorage(e: StorageEvent): void {
  if (e.key !== FOLDS_KEY && e.key !== null) return;
  folds = read();
  emit();
}

function subscribe(fn: () => void): () => void {
  // for the life of the window: another window of the exploded view folds too
  if (!watching && typeof window !== 'undefined') { watching = true; window.addEventListener('storage', onStorage); }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useFolds(): Folds {
  return useSyncExternalStore(subscribe, getFolds);
}

/** Tests only. */
export function __resetFoldsForTests(): void {
  folds = null;
}
