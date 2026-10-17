/**
 * screen.ts — what the window shows, shared by the clicks and the voice.
 *
 * The tab on screen, the last search and its results, the reply drafts under
 * the comments and the upload form. A voice handler writes HERE (show a tab,
 * fill a draft) and the screen redraws, so the person sees what was prepared
 * before anything is sent. Nothing in this store sends anything.
 */
import { useSyncExternalStore } from 'react';

export const TABS = ['player', 'playlists', 'search', 'music', 'channel', 'upload', 'settings'] as const;
export type Tab = typeof TABS[number];

export interface SearchHit {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  live: boolean;
  publishedAt: string | null;
}

export interface SearchState {
  query: string;
  live: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  results: SearchHit[];
  error: string | null;
}

export interface UploadDraft {
  title: string;
  description: string;
  /** null until the person says it: never decided for them. */
  madeForKids: boolean | null;
  file: { id: string; name: string; size: number } | null;
}

export interface ScreenState {
  tab: Tab;
  search: SearchState;
  /** threadId → the reply being written under that comment. */
  replyDrafts: Record<string, string>;
  /** The comment a voice prepared a reply for, to bring into view. */
  focusThread: string | null;
  upload: UploadDraft;
}

const INITIAL: ScreenState = {
  tab: 'player',
  search: { query: '', live: false, status: 'idle', results: [], error: null },
  replyDrafts: {},
  focusThread: null,
  upload: { title: '', description: '', madeForKids: null, file: null },
};

let state: ScreenState = INITIAL;
const listeners = new Set<() => void>();

export function getScreen(): ScreenState {
  return state;
}

export function patchScreen(patch: Partial<ScreenState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

let onShow: ((tab: Tab) => void) | null = null;

/** The sync link hears a tab asked for here, so the window of the exploded view that holds it shows it. */
export function setShowListener(fn: ((tab: Tab) => void) | null): void {
  onShow = fn;
}

export function showTab(tab: Tab, opts: { fromPeer?: boolean } = {}): void {
  patchScreen({ tab });
  if (!opts.fromPeer) onShow?.(tab);
}

export function setReplyDraft(threadId: string, text: string): void {
  patchScreen({ replyDrafts: { ...state.replyDrafts, [threadId]: text } });
}

export function patchUpload(patch: Partial<UploadDraft>): void {
  patchScreen({ upload: { ...state.upload, ...patch } });
}

export function subscribeScreen(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useScreen(): ScreenState {
  return useSyncExternalStore(subscribeScreen, getScreen);
}

/** Tests only. */
export function __resetScreenForTests(next: Partial<ScreenState> = {}): void {
  onShow = null;
  state = { ...INITIAL, ...next };
}
