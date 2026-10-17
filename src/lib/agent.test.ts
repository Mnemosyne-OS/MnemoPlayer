/**
 * The voice handlers (doc 151 §7): each does what the window's own button does,
 * takes things by the words a person says, refuses AMBIGUOUS / NO_x with the
 * names, never sends a reply or an upload, and says what it found out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./host', async () => {
  const real = await vi.importActual<typeof import('./host')>('./host');
  return { ...real, call: vi.fn(), hasHost: () => true };
});

import { call } from './host';
import { youtubeAgentHandlers } from './agent';
import { __resetAccountForTests, type Thread } from './account';
import { __resetLibraryForTests, getLibrarySnapshot } from './libraryStore';
import { EMPTY_LIBRARY, type Item, type Library } from './library';
import { __resetMusicForTests } from './music';
import * as player from './player';
import { __resetScreenForTests, getScreen } from './screen';

const yt = (id: string, title: string, channel?: string): Item => ({ kind: 'yt', videoId: id.padEnd(11, '0').slice(0, 11), title, ...(channel ? { channel } : {}) });
const JAZZ = [yt('jazz1', 'Blue in Green'), yt('jazz2', 'So What')];
const lib = (over: Partial<Library> = {}): Library => ({
  ...EMPTY_LIBRARY,
  playlists: [
    { id: 'p1', name: 'Jazz du dimanche', items: JAZZ, createdAt: '2026-10-01T00:00:00Z' },
    { id: 'p2', name: 'Rock 80', items: [yt('rock8', 'Take On Me')], createdAt: '2026-10-01T00:00:00Z' },
    { id: 'p3', name: 'Rock 90', items: [], createdAt: '2026-10-01T00:00:00Z' },
  ],
  ...over,
});
const thread = (id: string, author: string, videoId: string, publishedAt: string, canReply = true): Thread => ({
  id, author, videoId, publishedAt, canReply, text: `comment of ${author}`, likes: 0, replyCount: 0, replies: [],
});

const h = youtubeAgentHandlers({ newId: () => 'new1', now: () => new Date('2026-10-13T12:00:00Z') });
const mockCall = vi.mocked(call);

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockResolvedValue(undefined);
  __resetLibraryForTests({ status: 'ready', library: lib() });
  __resetAccountForTests();
  __resetMusicForTests();
  __resetScreenForTests();
  player.__resetPlayerForTests();
});

describe('playing by voice', () => {
  it('a playlist by the words a person says, from its first item, said back', () => {
    const r = h.playPlaylist({ name: 'ma playlist du dimanche' });
    expect(r).toMatchObject({ playlist: 'Jazz du dimanche', title: 'Blue in Green' });
    expect(r.say).toMatch(/Blue in Green/);
    expect(player.getPlayer()).toMatchObject({ playing: true, index: 0, from: { kind: 'playlist', name: 'Jazz du dimanche' } });
    expect(getScreen().tab).toBe('player');
  });

  it('two playlists that hold the words are refused with their names', () => {
    expect(() => h.playPlaylist({ name: 'rock' })).toThrow('AMBIGUOUS: "rock" names several playlists: Rock 80, Rock 90; say which');
    expect(() => h.playPlaylist({ name: 'classique' })).toThrow(/^NO_PLAYLIST: .*Jazz du dimanche, Rock 80, Rock 90/);
    expect(() => h.playPlaylist({ name: 'Rock 90' })).toThrow(/^EMPTY_PLAYLIST/);
  });

  it('pause / play / next / previous are the buttons; nothing loaded is refused', () => {
    expect(() => h.play()).toThrow(/^NOTHING_TO_PLAY/);
    h.playPlaylist({ name: 'jazz' });
    h.pause();
    expect(player.getPlayer().playing).toBe(false);
    expect(h.play()).toMatchObject({ playing: true, title: 'Blue in Green' });
    expect(h.next()).toMatchObject({ title: 'So What' });
    expect(h.next()).toMatchObject({ endOfList: true });
    expect(player.getPlayer().playing).toBe(false);
    expect(h.previous()).toMatchObject({ title: 'Blue in Green' });
  });

  it('the volume: a level, or a step, kept for next time', async () => {
    expect(await h.setVolume({ change: 'up' })).toEqual({ volume: 95, muted: false });
    expect(await h.setVolume({ level: 30 })).toEqual({ volume: 30, muted: false });
    expect(await h.setVolume({ change: 'mute' })).toEqual({ volume: 30, muted: true });
    expect(getLibrarySnapshot().library.volume).toBe(30);
    await expect(h.setVolume({})).rejects.toThrow(/^BAD_ARG/);
  });

  it('a title found in a playlist plays in that playlist; a search result by its number', () => {
    expect(h.playItem({ title: 'so what' })).toMatchObject({ title: 'So What' });
    expect(player.getPlayer()).toMatchObject({ index: 1, from: { kind: 'playlist', name: 'Jazz du dimanche' } });
    expect(() => h.playItem({ number: 2 })).toThrow(/^NO_RESULTS/);
    __resetScreenForTests({ search: { query: 'jazz', live: true, status: 'ready', error: null, results: [
      { id: 'aaaaaaaaaaa', title: 'Live Paris', channel: 'Club', thumbnail: null, live: true, publishedAt: null },
      { id: 'bbbbbbbbbbb', title: 'Live Rome', channel: 'Club', thumbnail: null, live: true, publishedAt: null },
    ] } });
    expect(h.playItem({ number: 2 })).toMatchObject({ title: 'Live Rome' });
    expect(() => h.playItem({ number: 3 })).toThrow(/^NO_RESULT: the search on screen has 2 results/);
    expect(() => h.playItem({ title: 'live' })).toThrow(/^AMBIGUOUS: .*Live Paris, Live Rome/);
  });
});

describe('search, playlists', () => {
  it('a search shows the Search tab and says how many', async () => {
    mockCall.mockResolvedValueOnce([{ id: 'aaaaaaaaaaa', title: 'Jazz Live', channel: 'Club', thumbnail: null, live: true, publishedAt: null }]);
    const r = await h.search({ query: 'jazz', live: true });
    expect(mockCall).toHaveBeenCalledWith('youtube.search', { query: 'jazz', live: true, maxResults: 12 });
    expect(r).toMatchObject({ count: 1, results: [{ number: 1, title: 'Jazz Live' }] });
    expect(r.say).toMatch(/1/);
    expect(getScreen().tab).toBe('search');
  });

  it('a search without the key is said TO THE PERSON, not repaired', async () => {
    mockCall.mockRejectedValueOnce(new Error('KEY_MISSING'));
    await expect(h.search({ query: 'jazz' })).rejects.toThrow(/^TO_PERSON: /);
  });

  it('« add this to Rock 80 » adds what is playing; twice says already', async () => {
    await expect(h.addToPlaylist({ playlist: 'rock 80' })).rejects.toThrow(/^NOTHING_PLAYING/);
    h.playPlaylist({ name: 'jazz' });
    expect(await h.addToPlaylist({ playlist: 'rock 80' })).toMatchObject({ added: true, title: 'Blue in Green' });
    expect(getLibrarySnapshot().library.playlists[1]!.items.map((i) => i.title)).toEqual(['Take On Me', 'Blue in Green']);
    expect(await h.addToPlaylist({ playlist: 'rock 80' })).toMatchObject({ already: true });
    await expect(h.addToPlaylist({ playlist: 'rock' })).rejects.toThrow(/^AMBIGUOUS/);
  });

  it('a refused save is WRITE_FAILED, never reported done', async () => {
    mockCall.mockRejectedValue(new Error('Host did not reply'));
    h.playPlaylist({ name: 'jazz' });
    await expect(h.addToPlaylist({ playlist: 'rock 80' })).rejects.toThrow(/^WRITE_FAILED/);
    expect(getLibrarySnapshot().library.playlists[1]!.items).toHaveLength(1);
  });

  it('creates a playlist, and refuses a name taken', async () => {
    expect(await h.createPlaylist({ name: 'Sport' })).toEqual({ playlist: 'Sport', created: true });
    await expect(h.createPlaylist({ name: 'sport' })).rejects.toThrow(/^DUPLICATE/);
  });

  it('the music folder: none chosen is said to the person', async () => {
    await expect(h.playMusic()).rejects.toThrow(/^TO_PERSON: /);
  });
});

describe('the channel: read, and only DRAFT', () => {
  const threads = [
    thread('t1', 'Léa', 'v1', '2026-10-12T10:00:00Z'),
    thread('t2', 'Léa', 'v2', '2026-10-10T10:00:00Z'),
    thread('t3', 'Marc', 'v1', '2026-10-01T10:00:00Z', false),
  ];

  it('says how many comments are new since the person last looked', async () => {
    __resetLibraryForTests({ status: 'ready', library: lib({ commentsSeenAt: '2026-10-11T00:00:00Z' }) });
    __resetAccountForTests({ comments: threads });
    const r = await h.comments();
    expect(r).toMatchObject({ total: 3, new: 1 });
    expect(r.say).toMatch(/1/);
  });

  it('a reply is put in the box under the comment, NEVER sent', async () => {
    __resetAccountForTests({ comments: threads, videos: [
      { id: 'v1', title: 'Ma recette de pain', publishedAt: null, thumbnail: null, privacy: 'public', views: 1, likes: 0, comments: 2 },
      { id: 'v2', title: 'Le potager', publishedAt: null, thumbnail: null, privacy: 'public', views: 1, likes: 0, comments: 1 },
    ] });
    await expect(h.draftReply({ author: 'Léa', text: 'Merci !' })).rejects.toThrow(/^AMBIGUOUS: .*Léa \(Ma recette de pain\), Léa \(Le potager\)/);
    const r = await h.draftReply({ author: 'Léa', video: 'potager', text: 'Merci !' });
    expect(r).toMatchObject({ author: 'Léa', drafted: true, sent: false });
    expect(getScreen().replyDrafts.t2).toBe('Merci !');
    expect(getScreen()).toMatchObject({ tab: 'channel', focusThread: 't2' });
    await expect(h.draftReply({ author: 'Marc', text: 'Merci' })).rejects.toThrow(/^REPLY_CLOSED/);
    expect(mockCall).not.toHaveBeenCalledWith('youtube.reply', expect.anything());
  });

  it('an upload is only a form filled on screen', () => {
    expect(h.draftUpload({ title: 'Mon pain', description: 'La recette' })).toMatchObject({ drafted: true, sent: false });
    expect(getScreen().upload).toMatchObject({ title: 'Mon pain', description: 'La recette', madeForKids: null, file: null });
    expect(getScreen().tab).toBe('upload');
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('channel stats: a hidden count is null and left out of what is said', async () => {
    mockCall.mockResolvedValueOnce({ id: 'UC1', title: 'Tony', thumbnail: null, subscribers: null, views: 1200, videos: 4 });
    const r = await h.channelStats();
    expect(r).toMatchObject({ subscribers: null, views: 1200 });
    expect(r.say).not.toMatch(/null|abonn|subscri/);
  });

  it('not connected is said to the person', async () => {
    mockCall.mockRejectedValueOnce(new Error('NOT_CONNECTED'));
    await expect(h.channelStats()).rejects.toThrow(/^TO_PERSON: /);
  });
});
