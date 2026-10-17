/**
 * music.ts — the person's own music folder (doc 151 §3).
 *
 * Read through the host's `dialog:open` doors, home-scoped: the person picks
 * the folder in the system dialog, the host lists it and hands each file back
 * as a data URL (50 MB cap per file, the host's). The folder's PATH is kept in
 * the durable state: that is the `dialog:open` model every cartridge uses (the
 * cartridge already holds the paths the host lists), and the host re-checks
 * every read against the home folder.
 */
import { useSyncExternalStore } from 'react';
import { call, codeOf } from './host';
import type { Item } from './library';

/** What the host's readable list lets through (flac/m4a/aac/opus joined it with this cartridge). */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] as const;
export const MAX_TRACKS = 1000;
const MAX_DEPTH = 2;

interface DirEntry { name: string; isDirectory: boolean; path: string; sizeBytes?: number }

export interface MusicSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  tracks: Item[];
  /** True when the folder held more than MAX_TRACKS: said, never cut in silence. */
  capped: boolean;
  error: string | null;
}

let snap: MusicSnapshot = { status: 'idle', tracks: [], capped: false, error: null };
const listeners = new Set<() => void>();
const publish = (next: MusicSnapshot) => { snap = next; listeners.forEach((fn) => fn()); };

export function getMusic(): MusicSnapshot {
  return snap;
}

export function useMusic(): MusicSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getMusic);
}

export const isAudio = (name: string): boolean => (AUDIO_EXTENSIONS as readonly string[]).includes(name.split('.').pop()?.toLowerCase() ?? '');
/** « 03 - Blue in Green.flac » → « Blue in Green ». */
export function trackTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}\s*[-._)]\s*/, '').trim() || name;
}

async function listDir(path: string): Promise<DirEntry[]> {
  const res = await call<{ success?: boolean; files?: DirEntry[]; error?: string }>('dialog.readDir', { dirPath: path });
  if (!res?.success) throw new Error('READ_DIR_FAILED');
  return Array.isArray(res.files) ? res.files : [];
}

/** Lists the audio files of a folder and of its subfolders (two levels: artist / album). */
export async function scanFolder(folder: string, list: (p: string) => Promise<DirEntry[]> = listDir): Promise<{ tracks: Item[]; capped: boolean }> {
  const tracks: Item[] = [];
  let capped = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = (await list(dir)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      if (tracks.length >= MAX_TRACKS) { capped = true; return; }
      if (e.isDirectory) { if (depth < MAX_DEPTH) await walk(e.path, depth + 1); }
      else if (isAudio(e.name)) tracks.push({ kind: 'local', path: e.path, title: trackTitle(e.name) });
    }
  };
  await walk(folder, 0);
  return { tracks, capped };
}

export async function loadMusic(folder: string | null): Promise<Item[]> {
  if (!folder) { publish({ status: 'idle', tracks: [], capped: false, error: null }); return []; }
  publish({ ...snap, status: 'loading', error: null });
  try {
    const { tracks, capped } = await scanFolder(folder);
    publish({ status: 'ready', tracks, capped, error: null });
    return tracks;
  } catch (err) {
    publish({ status: 'error', tracks: [], capped: false, error: codeOf(err) });
    return [];
  }
}

/** The person picks a folder in the system dialog. Null when they cancel. */
export async function pickMusicFolder(): Promise<string | null> {
  // No deadline: the dialog stays open as long as the person is choosing.
  const path = await call<string | null>('dialog.selectFolder', { startIn: 'Music' }, 0);
  return typeof path === 'string' && path ? path : null;
}

/** A local track as a data URL for the <audio> element (the host caps a file at 50 MB). */
export async function readTrack(path: string): Promise<string> {
  const res = await call<{ success?: boolean; content?: string; error?: string }>('dialog.readFile', { filePath: path }, 60_000);
  if (!res?.success || typeof res.content !== 'string' || !res.content.startsWith('data:')) {
    throw new Error(/too large/i.test(res?.error ?? '') ? 'TRACK_TOO_LARGE' : 'READ_FAILED');
  }
  return res.content;
}

/** Tests only. */
export function __resetMusicForTests(next: Partial<MusicSnapshot> = {}): void {
  snap = { status: 'idle', tracks: [], capped: false, error: null, ...next };
}
