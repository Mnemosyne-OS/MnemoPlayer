/**
 * library.ts — the person's own selections, their music folder and a few
 * remembered choices (doc 151 §3).
 *
 * Kept in the host's DURABLE STATE (doc 73), not in a vault: a playlist is a
 * list of things to play, not a memory to recall, and it must survive the
 * iframe's origin changing (dev server ↔ installed) without a dialog or a
 * permission. The host caps that state at 256 KB, so every change is
 * measured before it is saved and refused by name (`FULL`) past a budget —
 * never truncated in silence.
 *
 * Re-normalised on EVERY read: a hand-edited or older blob never reaches the
 * screen as it is.
 */

export type Item =
  | { kind: 'yt'; videoId: string; title: string; channel?: string }
  | { kind: 'local'; path: string; title: string };

export interface Playlist {
  id: string;
  name: string;
  items: Item[];
  createdAt: string;
}

export interface Library {
  playlists: Playlist[];
  /** The music folder the person picked (a path in their home), or null. */
  musicFolder: string | null;
  /** When the person last looked at the comments of their channel, or null. */
  commentsSeenAt: string | null;
  /** 0..100, the last volume set. */
  volume: number;
}

export const EMPTY_LIBRARY: Library = { playlists: [], musicFolder: null, commentsSeenAt: null, volume: 80 };
export const MAX_PLAYLISTS = 40;
export const MAX_ITEMS_PER_PLAYLIST = 500;
export const NAME_MAX = 80;
export const TITLE_MAX = 200;
/** Under the host's 256 KB, with room for the envelope. Measured on the JSON that is saved. */
export const STATE_BUDGET = 240_000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function normalizeItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'yt' && typeof r.videoId === 'string' && VIDEO_ID.test(r.videoId)) {
    const channel = clip(r.channel, TITLE_MAX);
    return { kind: 'yt', videoId: r.videoId, title: clip(r.title, TITLE_MAX) || r.videoId, ...(channel ? { channel } : {}) };
  }
  if (r.kind === 'local' && typeof r.path === 'string' && r.path.trim()) {
    return { kind: 'local', path: r.path.trim(), title: clip(r.title, TITLE_MAX) || r.path.split(/[\\/]/).pop() || r.path };
  }
  return null;
}

export function normalizeLibrary(raw: unknown): Library {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LIBRARY, playlists: [] };
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const playlists: Playlist[] = [];
  for (const p of Array.isArray(r.playlists) ? r.playlists : []) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    const id = typeof q.id === 'string' && q.id ? q.id : '';
    const name = clip(q.name, NAME_MAX);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const items = (Array.isArray(q.items) ? q.items : []).map(normalizeItem).filter((i): i is Item => i !== null).slice(0, MAX_ITEMS_PER_PLAYLIST);
    playlists.push({ id, name, items, createdAt: isDate(q.createdAt) ? q.createdAt : new Date(0).toISOString() });
    if (playlists.length >= MAX_PLAYLISTS) break;
  }
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(100, Math.max(0, Math.round(r.volume))) : EMPTY_LIBRARY.volume;
  return {
    playlists,
    musicFolder: typeof r.musicFolder === 'string' && r.musicFolder.trim() ? r.musicFolder.trim() : null,
    commentsSeenAt: isDate(r.commentsSeenAt) ? r.commentsSeenAt : null,
    volume,
  };
}

export type LibraryRefusal = 'FULL' | 'DUPLICATE' | 'EMPTY_NAME' | 'NO_PLAYLIST' | 'ALREADY_IN';
export type Change = { ok: true; library: Library } | { ok: false; code: LibraryRefusal };

/** True when the library fits the host's state once saved. */
export function fits(lib: Library): boolean {
  return JSON.stringify(lib).length <= STATE_BUDGET;
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

export function createPlaylist(lib: Library, rawName: string, id: string, now: string): Change {
  const name = clip(rawName, NAME_MAX);
  if (!name) return { ok: false, code: 'EMPTY_NAME' };
  if (lib.playlists.some((p) => sameName(p.name, name))) return { ok: false, code: 'DUPLICATE' };
  if (lib.playlists.length >= MAX_PLAYLISTS) return { ok: false, code: 'FULL' };
  const next = { ...lib, playlists: [...lib.playlists, { id, name, items: [], createdAt: now }] };
  return fits(next) ? { ok: true, library: next } : { ok: false, code: 'FULL' };
}

export function renamePlaylist(lib: Library, id: string, rawName: string): Change {
  const name = clip(rawName, NAME_MAX);
  if (!name) return { ok: false, code: 'EMPTY_NAME' };
  if (!lib.playlists.some((p) => p.id === id)) return { ok: false, code: 'NO_PLAYLIST' };
  if (lib.playlists.some((p) => p.id !== id && sameName(p.name, name))) return { ok: false, code: 'DUPLICATE' };
  return { ok: true, library: { ...lib, playlists: lib.playlists.map((p) => (p.id === id ? { ...p, name } : p)) } };
}

/** Deleting a playlist is a click of the person, never an action of the voice. */
export function removePlaylist(lib: Library, id: string): Change {
  if (!lib.playlists.some((p) => p.id === id)) return { ok: false, code: 'NO_PLAYLIST' };
  return { ok: true, library: { ...lib, playlists: lib.playlists.filter((p) => p.id !== id) } };
}

export const sameItem = (a: Item, b: Item): boolean =>
  a.kind === 'yt' ? b.kind === 'yt' && a.videoId === b.videoId : b.kind === 'local' && a.path === b.path;

export function addItem(lib: Library, playlistId: string, raw: Item): Change {
  const item = normalizeItem(raw);
  const pl = lib.playlists.find((p) => p.id === playlistId);
  if (!pl || !item) return { ok: false, code: 'NO_PLAYLIST' };
  if (pl.items.some((i) => sameItem(i, item))) return { ok: false, code: 'ALREADY_IN' };
  if (pl.items.length >= MAX_ITEMS_PER_PLAYLIST) return { ok: false, code: 'FULL' };
  const next = { ...lib, playlists: lib.playlists.map((p) => (p.id === playlistId ? { ...p, items: [...p.items, item] } : p)) };
  return fits(next) ? { ok: true, library: next } : { ok: false, code: 'FULL' };
}

export function removeItem(lib: Library, playlistId: string, index: number): Change {
  const pl = lib.playlists.find((p) => p.id === playlistId);
  if (!pl || !pl.items[index]) return { ok: false, code: 'NO_PLAYLIST' };
  return { ok: true, library: { ...lib, playlists: lib.playlists.map((p) => (p.id === playlistId ? { ...p, items: p.items.filter((_, i) => i !== index) } : p)) } };
}

/** A video id from what a person pastes: a watch URL, a short URL, a shorts URL, or the id itself. */
export function videoIdFrom(text: string): string | null {
  const t = text.trim();
  if (VIDEO_ID.test(t)) return t;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v');
    const m = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname);
    if (!id && m) id = m[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}
