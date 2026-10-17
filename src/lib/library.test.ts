import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addItem, createPlaylist, EMPTY_LIBRARY, fits, MAX_PLAYLISTS, normalizeLibrary, STATE_BUDGET, videoIdFrom, type Library } from './library';
import { readPlayerMessage, playerErrorCode, embedUrl, EMBED_ORIGIN } from './ytEmbed';
import { scanFolder, trackTitle } from './music';
import { newSince, type Thread } from './account';

const base = (): Library => ({ ...EMPTY_LIBRARY, playlists: [] });

describe('the library in the durable state (doc 151 §3)', () => {
  it('re-normalises what it reads: junk out, ids unique, volume bounded', () => {
    const lib = normalizeLibrary({
      playlists: [
        { id: 'a', name: ' Jazz ', items: [{ kind: 'yt', videoId: 'dQw4w9WgXcQ', title: 'X' }, { kind: 'yt', videoId: 'bad' }, { kind: 'evil' }], createdAt: 'nope' },
        { id: 'a', name: 'dup id' }, { name: 'no id' },
      ],
      volume: 400, musicFolder: '  ', commentsSeenAt: 'never',
    });
    expect(lib.playlists).toHaveLength(1);
    expect(lib.playlists[0]).toMatchObject({ name: 'Jazz', items: [{ videoId: 'dQw4w9WgXcQ' }] });
    expect(lib).toMatchObject({ volume: 100, musicFolder: null, commentsSeenAt: null });
  });

  it('refuses by name, never truncates in silence', () => {
    let lib = base();
    for (let i = 0; i < MAX_PLAYLISTS; i += 1) {
      const r = createPlaylist(lib, `P${i}`, `id${i}`, '2026-10-13T00:00:00Z');
      if (!r.ok) throw new Error(r.code);
      lib = r.library;
    }
    expect(createPlaylist(lib, 'one more', 'x', 'd')).toEqual({ ok: false, code: 'FULL' });
    expect(createPlaylist(base(), '  ', 'x', 'd')).toEqual({ ok: false, code: 'EMPTY_NAME' });
  });

  it('measures the saved size against the host’s 256 KB cap', () => {
    const r = createPlaylist(base(), 'Big', 'b', 'd');
    if (!r.ok) throw new Error(r.code);
    let lib = r.library;
    let refused: string | null = null;
    for (let i = 0; i < 500 && !refused; i += 1) {
      const res = addItem(lib, 'b', { kind: 'local', path: `C:/Music/${'x'.repeat(400)}/${i}.mp3`, title: 't'.repeat(200) });
      if (res.ok) lib = res.library; else refused = res.code;
    }
    expect(refused).toBe('FULL');
    expect(fits(lib)).toBe(true);
    expect(JSON.stringify(lib).length).toBeLessThanOrEqual(STATE_BUDGET);
  });

  it('finds the video id in what a person pastes', () => {
    expect(videoIdFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('dQw4w9WgXcQ');
    expect(videoIdFrom('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFrom('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFrom('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFrom('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoIdFrom('jazz')).toBeNull();
  });
});

describe('the player protocol (doc 151 §2)', () => {
  it('reads the frame’s JSON and ignores the rest', () => {
    expect(readPlayerMessage('{"event":"onReady"}')).toEqual({ ready: true });
    expect(readPlayerMessage('{"event":"infoDelivery","info":{"playerState":1,"currentTime":4.4,"duration":212}}')).toEqual({ state: 1, time: 4.4, duration: 212 });
    expect(readPlayerMessage('{"event":"onError","info":153}')).toEqual({ error: 153 });
    expect(readPlayerMessage('not json')).toBeNull();
    expect(readPlayerMessage({ type: 'MNEMO_PLUGIN_REPLY' })).toBeNull();
  });
  it('names the player errors, 153 included', () => {
    expect(playerErrorCode(150)).toBe('NOT_EMBEDDABLE');
    expect(playerErrorCode(101)).toBe('NOT_EMBEDDABLE');
    expect(playerErrorCode(100)).toBe('VIDEO_NOT_FOUND');
    expect(playerErrorCode(153)).toBe('PLAYER_IDENTITY');
  });
  it('the embed is the no-cookie host with the protocol on', () => {
    const u = new URL(embedUrl('dQw4w9WgXcQ', 'mnemo-plugin://app', true));
    expect(u.origin).toBe(EMBED_ORIGIN);
    expect(u.searchParams.get('enablejsapi')).toBe('1');
    expect(u.searchParams.get('autoplay')).toBe('1');
    expect(u.searchParams.get('origin')).toBe('mnemo-plugin://app');
  });
});

describe('the music folder and the comments', () => {
  it('lists audio two levels deep, sorted, with readable titles', async () => {
    const tree: Record<string, Array<{ name: string; isDirectory: boolean; path: string }>> = {
      root: [{ name: 'B.mp3', isDirectory: false, path: 'root/B.mp3' }, { name: 'Album', isDirectory: true, path: 'root/Album' }, { name: 'cover.jpg', isDirectory: false, path: 'root/cover.jpg' }],
      'root/Album': [{ name: '02 - So What.flac', isDirectory: false, path: 'root/Album/02.flac' }, { name: 'Deep', isDirectory: true, path: 'root/Album/Deep' }],
      'root/Album/Deep': [{ name: 'Too deep', isDirectory: true, path: 'root/Album/Deep/X' }, { name: 'c.ogg', isDirectory: false, path: 'root/Album/Deep/c.ogg' }],
    };
    const { tracks, capped } = await scanFolder('root', (p) => Promise.resolve(tree[p] ?? []));
    expect(tracks.map((t) => t.title)).toEqual(['So What', 'c', 'B']);
    expect(capped).toBe(false);
    expect(trackTitle('03 - Blue in Green.flac')).toBe('Blue in Green');
  });
  it('new comments are those after the last look; never looked = all', () => {
    const c = (id: string, at: string | null) => ({ id, publishedAt: at }) as Thread;
    expect(newSince([c('a', '2026-10-12T00:00:00Z'), c('b', '2026-10-01T00:00:00Z'), c('n', null)], '2026-10-05T00:00:00Z').map((x) => x.id)).toEqual(['a']);
    expect(newSince([c('a', null)], null)).toHaveLength(1);
  });
});

describe('the three languages say the same things', () => {
  const read = (l: string) => JSON.parse(readFileSync(join(__dirname, '..', 'i18n', 'locales', `${l}.json`), 'utf8')) as Record<string, unknown>;
  const keys = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
  it('fr, en and es carry the same keys', () => {
    const en = keys(read('en')).sort();
    expect(keys(read('fr')).sort()).toEqual(en);
    expect(keys(read('es')).sort()).toEqual(en);
  });
  it('every code the host’s YouTube door can answer has a sentence', () => {
    const codes = Object.keys(read('en').code ?? {});
    const host = ['KEY_MISSING', 'KEY_REFUSED', 'KEY_RESTRICTED', 'NO_CLIENT', 'NOT_CONNECTED', 'TOKEN_EXPIRED', 'SCOPE_MISSING', 'NO_CHANNEL', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'COMMENTS_DISABLED', 'FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'TIMEOUT', 'NETWORK_OFFLINE', 'NETWORK', 'BAD_RESPONSE', 'SERVER_ERROR', 'EMPTY_QUERY', 'MISSING_THREAD', 'EMPTY_REPLY', 'CANCELED', 'NOT_A_FILE', 'NOT_A_VIDEO', 'EMPTY_FILE', 'TOO_LARGE', 'PICK_FAILED', 'UNKNOWN_FILE', 'NO_TITLE', 'MADE_FOR_KIDS_UNSET', 'ALREADY_UPLOADING', 'UNKNOWN_JOB', 'CANCELLED', 'TOO_SOON', 'NOT_FROM_A_GESTURE', 'CONSENT_REFUSED', 'CONSENT_TIMEOUT', 'CONNECT_FAILED', 'NO_CLIENT', 'SEAL_REFUSED', 'EMPTY', 'HAS_WHITESPACE', 'LOOKS_LIKE_URL', 'TOO_LONG'];
    expect(host.filter((c) => !codes.includes(c))).toEqual([]);
  });
});
