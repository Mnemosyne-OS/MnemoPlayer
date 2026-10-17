/**
 * account.ts — the person's YouTube connection and channel, as this window
 * last read them (doc 151 §4-§5).
 *
 * Read on demand (opening a tab, a voice question), never polled: every read
 * spends the person's daily quota. Each part keeps its own error so a refused
 * comment read does not blank the statistics above it. Absent is `null`,
 * never an empty list: « not read yet » and « nothing there » are two
 * different screens.
 */
import { useSyncExternalStore } from 'react';
import { call, codeOf } from './host';
import { getScreen, patchScreen, type SearchHit } from './screen';

export interface KeyState { present: boolean; savedAt: number | null; seal: string }
export interface AccountState { hasClient: boolean; connected: boolean; canRead: boolean; canReply: boolean; canUpload: boolean }
export interface Channel { id: string; title: string; thumbnail: string | null; subscribers: number | null; views: number | null; videos: number | null }
export interface Video { id: string; title: string; publishedAt: string | null; thumbnail: string | null; privacy: string | null; views: number | null; likes: number | null; comments: number | null }
export interface YtPlaylist { id: string; title: string; count: number | null; thumbnail: string | null }
export interface CommentLine { id: string; author: string; text: string; publishedAt: string | null; likes: number | null }
export interface Thread extends CommentLine { videoId: string; canReply: boolean; replyCount: number | null; replies: CommentLine[] }

type Part = 'key' | 'account' | 'channel' | 'videos' | 'playlists' | 'comments';

export interface AccountSnapshot {
  key: KeyState | null;
  account: AccountState | null;
  channel: Channel | null;
  videos: Video[] | null;
  playlists: YtPlaylist[] | null;
  comments: Thread[] | null;
  loading: Partial<Record<Part, boolean>>;
  errors: Partial<Record<Part, string>>;
}

const INITIAL: AccountSnapshot = { key: null, account: null, channel: null, videos: null, playlists: null, comments: null, loading: {}, errors: {} };
let snap: AccountSnapshot = INITIAL;
const listeners = new Set<() => void>();

function publish(patch: Partial<AccountSnapshot>): void {
  snap = { ...snap, ...patch };
  listeners.forEach((fn) => fn());
}

export function getAccount(): AccountSnapshot {
  return snap;
}

export function useAccount(): AccountSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getAccount);
}

const ACTION: Record<Part, string> = {
  key: 'youtube.keyState', account: 'youtube.accountState', channel: 'youtube.channel',
  videos: 'youtube.videos', playlists: 'youtube.playlists', comments: 'youtube.comments',
};
/** Channel reads are two calls in main (channel, then the list). */
const TIMEOUT: Partial<Record<Part, number>> = { channel: 40_000, videos: 40_000, playlists: 40_000, comments: 40_000 };

/** Reads one part; on refusal keeps the last good value and sets its error. Resolves to the value or null. */
export async function load<P extends Part>(part: P): Promise<AccountSnapshot[P] | null> {
  publish({ loading: { ...snap.loading, [part]: true }, errors: { ...snap.errors, [part]: undefined } });
  try {
    const raw = await call<unknown>(ACTION[part], undefined, TIMEOUT[part]);
    const value = (part === 'comments' ? (raw as { threads?: unknown })?.threads ?? null : raw) as AccountSnapshot[P];
    publish({ [part]: value, loading: { ...snap.loading, [part]: false } });
    return value;
  } catch (err) {
    publish({ loading: { ...snap.loading, [part]: false }, errors: { ...snap.errors, [part]: codeOf(err) } });
    return null;
  }
}

/** Reads key + sign-in state (cheap: no Google call). */
export async function refreshConnection(): Promise<void> {
  await Promise.all([load('key'), load('account')]);
}

/** Comments written after the person last looked; all of them when they never looked. */
export function newSince(threads: readonly Thread[], seenAt: string | null): Thread[] {
  if (!seenAt) return [...threads];
  const t = Date.parse(seenAt);
  return threads.filter((c) => c.publishedAt !== null && Date.parse(c.publishedAt) > t);
}

/** Runs a search for the screen; the results land where the Search tab reads them. */
export async function runSearch(query: string, live: boolean): Promise<SearchHit[]> {
  const q = query.trim();
  patchScreen({ search: { ...getScreen().search, query: q, live, status: 'loading', error: null } });
  try {
    const results = await call<SearchHit[]>('youtube.search', { query: q, live, maxResults: 12 });
    patchScreen({ search: { query: q, live, status: 'ready', results: Array.isArray(results) ? results : [], error: null } });
    return Array.isArray(results) ? results : [];
  } catch (err) {
    const code = codeOf(err);
    patchScreen({ search: { query: q, live, status: 'error', results: [], error: code } });
    throw new Error(code);
  }
}

/** Tests only. */
export function __resetAccountForTests(next: Partial<AccountSnapshot> = {}): void {
  snap = { ...INITIAL, ...next };
}
