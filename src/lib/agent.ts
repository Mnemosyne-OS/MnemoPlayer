/**
 * agent.ts — what a voice or an agent may do in MnemoPlayer (doc 149, doc 151
 * §7), declared in `mnemo-plugin.json` › agentActions and served by
 * YoutubeAgentActions while the window is open.
 *
 * Each handler calls the SAME function as the window's own button (the player
 * store, the library store, the screen store, the search runner), so the
 * person sees it happen.
 *
 * 🚨 Outward actions stay the person's gesture. A reply to a comment and an
 * upload are PREPARED here (a draft on screen: `draftReply`, `draftUpload`)
 * and SENT only by a click in the window: there is no `sendReply` and no
 * `upload` action, and the host refuses those doors without a click anyway.
 * Nothing here deletes anything.
 *
 * Things are taken by the words a person says (a playlist's name, a video's
 * title, a comment's author), never only by an id: several matches are
 * refused AMBIGUOUS with their names, none NO_<THING> with what exists.
 */
import { findNamed, type Named } from './agentFind';
import { getAccount, load, newSince, runSearch, type Thread, type Video } from './account';
import { translate as t } from '../i18n/useI18n';
import { videoIdFrom, addItem, createPlaylist, type Item, type Library, type Playlist } from './library';
import { getLibrarySnapshot, updateLibrary } from './libraryStore';
import { getMusic, loadMusic } from './music';
import * as player from './player';
import { getScreen, patchScreen, patchUpload, setReplyDraft, showTab, TABS, type SearchHit, type Tab } from './screen';
import { setEqualizerAction, setVisualizerAction } from './soundAgent';

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface AgentDeps {
  newId: () => string;
  now: () => Date;
}

/** Codes a repair call cannot fix: said to the person in their language, never retried in their place. */
const TO_PERSON = new Set(['KEY_MISSING', 'KEY_REFUSED', 'KEY_RESTRICTED', 'NO_CLIENT', 'NOT_CONNECTED', 'TOKEN_EXPIRED', 'SCOPE_MISSING', 'QUOTA_EXCEEDED', 'NO_CHANNEL', 'PERMISSION_DENIED', 'NO_HOST']);
function refuse(code: string): never {
  if (TO_PERSON.has(code)) throw new Error(`TO_PERSON: ${t(`code.${code}`)}`);
  throw new Error(`${code}: ${t(`code.${code}`)}`);
}

function requireLibrary(): Library {
  const snap = getLibrarySnapshot();
  if (snap.status === 'loading') throw new Error('NOT_READY: MnemoPlayer is still reading the saved playlists; try again in a moment');
  if (snap.status !== 'ready') throw new Error('NOT_READY: the saved playlists could not be read; the person sees it in MnemoPlayer');
  return snap.library;
}

const playlistNamed = (p: Playlist): Named<Playlist> => ({ item: p, id: p.id, names: [p.name], label: p.name });

export function findPlaylist(lib: Library, ref: string): Playlist {
  return findNamed(lib.playlists.map(playlistNamed), ref, { code: 'NO_PLAYLIST', noun: 'playlist' });
}

/** Something that can be played, where it was found, and the list it belongs to. */
interface Playable { item: Item; list: Item[]; index: number; from: player.QueueSource }

const hitItem = (h: SearchHit): Item => ({ kind: 'yt', videoId: h.id, title: h.title, ...(h.channel ? { channel: h.channel } : {}) });
const videoItem = (v: Video): Item => ({ kind: 'yt', videoId: v.id, title: v.title });
const keyOf = (i: Item) => (i.kind === 'yt' ? `yt:${i.videoId}` : `local:${i.path}`);

/** Every playable thing the window knows, each once: search on screen, playlists, the person's videos, the music folder. */
function playables(lib: Library): Array<Named<Playable>> {
  const out = new Map<string, Named<Playable>>();
  const add = (list: Item[], from: player.QueueSource) => list.forEach((item, index) => {
    const key = keyOf(item);
    if (out.has(key)) return;
    out.set(key, {
      item: { item, list, index, from },
      id: item.kind === 'yt' ? item.videoId : item.path,
      names: [item.title],
      aliases: item.kind === 'yt' && item.channel ? [item.channel] : [],
      label: item.title,
    });
  });
  const search = getScreen().search;
  add(search.results.map(hitItem), { kind: 'search', query: search.query });
  for (const p of lib.playlists) add(p.items, { kind: 'playlist', name: p.name });
  const videos = getAccount().videos;
  if (videos) add(videos.map(videoItem), { kind: 'channel' });
  add(getMusic().tracks, { kind: 'music' });
  return [...out.values()];
}

function findPlayable(lib: Library, ref: string): Playable {
  const id = videoIdFrom(ref);
  if (id) {
    const known = playables(lib).find((p) => p.item.item.kind === 'yt' && p.item.item.videoId === id);
    if (known) return known.item;
    const item: Item = { kind: 'yt', videoId: id, title: id };
    return { item, list: [item], index: 0, from: { kind: 'single' } };
  }
  return findNamed(playables(lib), ref, {
    code: 'NO_VIDEO', noun: 'video or song',
    whereToLook: 'nothing on screen, in the playlists, the person\'s videos or the music folder has that title; call search with the words to find it on YouTube',
  });
}

const fromLabel = (f: player.QueueSource | null) => (!f ? null : f.kind === 'playlist' ? `playlist ${f.name}` : f.kind === 'search' ? `search ${f.query}` : f.kind);

const commentNamed = (c: Thread, videoTitle: string): Named<Thread> => ({
  item: c, id: c.id, names: [c.author], aliases: videoTitle ? [videoTitle] : [], label: videoTitle ? `${c.author} (${videoTitle})` : c.author,
});

async function readyThreads(): Promise<Thread[]> {
  let threads = getAccount().comments;
  if (!threads) {
    threads = await load('comments');
    if (!threads) refuse(getAccount().errors.comments ?? 'FAILED');
  }
  return threads;
}

const videoTitle = (videoId: string) => getAccount().videos?.find((v) => v.id === videoId)?.title ?? '';

async function save(change: (lib: Library) => ReturnType<typeof addItem>): Promise<Library> {
  const res = await updateLibrary(change);
  if (!res.ok) {
    if (res.code === 'WRITE_FAILED' || res.code === 'NOT_READY') throw new Error(`WRITE_FAILED: the playlists could not be saved (${res.code}); the person sees them in MnemoPlayer`);
    refuse(res.code);
  }
  return res.library;
}

export function youtubeAgentHandlers(deps: AgentDeps) {
  return {
    // agent-actions:begin
    nowPlaying: () => {
      const s = player.getPlayer();
      const it = player.current(s);
      if (!it) return { playing: false, nothingLoaded: true };
      return {
        playing: s.playing, title: it.title, kind: it.kind === 'yt' ? 'youtube' : 'music',
        ...(it.kind === 'yt' && it.channel ? { channel: it.channel } : {}),
        from: fromLabel(s.from), position: s.position, duration: s.duration, volume: s.volume, muted: s.muted,
        ...(s.error ? { error: s.error } : {}),
      };
    },

    play: () => {
      let it: Item;
      try { it = player.play(); } catch { refuse('NOTHING_TO_PLAY'); }
      return { playing: true, title: it.title, say: t('say.playing', { title: it.title }) };
    },

    pause: () => {
      player.pause();
      return { playing: false };
    },

    next: () => {
      let it: Item | null;
      try { it = player.next(); } catch { refuse('NOTHING_TO_PLAY'); }
      return it ? { title: it.title, say: t('say.playing', { title: it.title }) } : { endOfList: true, say: t('say.endOfList') };
    },

    previous: () => {
      let it: Item;
      try { it = player.previous(); } catch { refuse('NOTHING_TO_PLAY'); }
      return { title: it.title, say: t('say.playing', { title: it.title }) };
    },

    setVolume: async (args: Record<string, unknown>) => {
      const s = player.getPlayer();
      const change = str(args.change);
      if (change === 'mute') player.setMuted(true);
      else if (change === 'unmute') player.setMuted(false);
      else if (change === 'up') player.setVolume(s.volume + player.VOLUME_STEP);
      else if (change === 'down') player.setVolume(s.volume - player.VOLUME_STEP);
      else if (typeof args.level === 'number' && Number.isFinite(args.level)) player.setVolume(args.level);
      else throw new Error('BAD_ARG: give level (0 to 100) or change (up, down, mute, unmute)');
      const after = player.getPlayer();
      // Remembered for the next session, as the slider does on release.
      const saved = await updateLibrary((lib) => ({ ok: true, library: { ...lib, volume: after.volume } }));
      if (!saved.ok && saved.code !== 'NOT_READY') console.warn('[youtube] volume not remembered:', saved.code);
      return { volume: after.volume, muted: after.muted };
    },

    playPlaylist: (args: Record<string, unknown>) => {
      const pl = findPlaylist(requireLibrary(), str(args.name));
      if (!pl.items.length) throw new Error(`EMPTY_PLAYLIST: "${pl.name}" has nothing in it yet; add a video with addToPlaylist`);
      const it = player.playQueue(pl.items, 0, { kind: 'playlist', name: pl.name });
      showTab('player');
      return { playlist: pl.name, items: pl.items.length, title: it.title, say: t('say.playlist', { name: pl.name, title: it.title }) };
    },

    playItem: (args: Record<string, unknown>) => {
      const lib = requireLibrary();
      let found: Playable;
      if (typeof args.number === 'number') {
        const results = getScreen().search.results;
        const n = Math.floor(args.number);
        if (!results.length) throw new Error('NO_RESULTS: there is no search on screen; call search first, or give a title');
        if (n < 1 || n > results.length) throw new Error(`NO_RESULT: the search on screen has ${results.length} results (1 to ${results.length})`);
        const list = results.map(hitItem);
        found = { item: list[n - 1]!, list, index: n - 1, from: { kind: 'search', query: getScreen().search.query } };
      } else {
        const ref = str(args.title);
        if (!ref) throw new Error('BAD_ARG: give the title (the words of it) or the number of a search result');
        found = findPlayable(lib, ref);
      }
      const it = player.playQueue(found.list, found.index, found.from);
      showTab('player');
      return { title: it.title, say: t('say.playing', { title: it.title }) };
    },

    search: async (args: Record<string, unknown>) => {
      const query = str(args.query);
      if (!query) throw new Error('BAD_ARG: say what to look for');
      const live = args.live === true;
      showTab('search');
      let hits: SearchHit[];
      try { hits = await runSearch(query, live); } catch (err) { refuse(err instanceof Error ? err.message : 'FAILED'); }
      return {
        query, live, count: hits.length,
        results: hits.map((h, i) => ({ number: i + 1, title: h.title, channel: h.channel, live: h.live })),
        say: hits.length ? t('say.results', { count: hits.length, query }) : t('say.noResults', { query }),
      };
    },

    createPlaylist: async (args: Record<string, unknown>) => {
      requireLibrary();
      const name = str(args.name);
      const lib = await save((cur) => createPlaylist(cur, name, deps.newId(), deps.now().toISOString()));
      const pl = lib.playlists[lib.playlists.length - 1]!;
      return { playlist: pl.name, created: true };
    },

    addToPlaylist: async (args: Record<string, unknown>) => {
      const lib = requireLibrary();
      const pl = findPlaylist(lib, str(args.playlist));
      const ref = str(args.title);
      let item: Item;
      if (ref) item = findPlayable(lib, ref).item;
      else {
        const it = player.current();
        if (!it) throw new Error('NOTHING_PLAYING: nothing is playing; give the title of what to add');
        item = it;
      }
      const res = await updateLibrary((cur) => addItem(cur, pl.id, item));
      if (!res.ok && res.code === 'ALREADY_IN') return { playlist: pl.name, title: item.title, already: true };
      if (!res.ok) {
        if (res.code === 'WRITE_FAILED' || res.code === 'NOT_READY') throw new Error(`WRITE_FAILED: the playlist could not be saved (${res.code}); the person sees it in MnemoPlayer`);
        refuse(res.code);
      }
      return { playlist: pl.name, title: item.title, added: true, say: t('say.added', { title: item.title, name: pl.name }) };
    },

    showTab: (args: Record<string, unknown>) => {
      const tab = str(args.tab) as Tab;
      if (!(TABS as readonly string[]).includes(tab)) throw new Error(`BAD_ARG: tab is one of ${TABS.join(', ')}`);
      showTab(tab);
      return { tab };
    },

    playMusic: async () => {
      const lib = requireLibrary();
      if (!lib.musicFolder) throw new Error(`TO_PERSON: ${t('code.NO_MUSIC_FOLDER')}`);
      let tracks = getMusic().tracks;
      if (!tracks.length) tracks = await loadMusic(lib.musicFolder);
      if (!tracks.length) refuse(getMusic().error ?? 'NO_TRACKS');
      const it = player.playQueue(tracks, 0, { kind: 'music' });
      showTab('player');
      return { tracks: tracks.length, title: it.title, say: t('say.playing', { title: it.title }) };
    },

    channelStats: async () => {
      const ch = getAccount().channel ?? (await load('channel'));
      if (!ch) refuse(getAccount().errors.channel ?? 'FAILED');
      const parts = [
        ch.subscribers !== null ? t('say.subscribers', { count: ch.subscribers }) : null,
        ch.views !== null ? t('say.views', { count: ch.views }) : null,
        ch.videos !== null ? t('say.videos', { count: ch.videos }) : null,
      ].filter(Boolean);
      return { channel: ch.title, subscribers: ch.subscribers, views: ch.views, videos: ch.videos, ...(parts.length ? { say: `${ch.title} : ${parts.join(', ')}` } : {}) };
    },

    comments: async () => {
      const threads = await readyThreads();
      const lib = getLibrarySnapshot().library;
      const fresh = new Set(newSince(threads, lib.commentsSeenAt).map((c) => c.id));
      return {
        total: threads.length,
        new: fresh.size,
        comments: threads.slice(0, 15).map((c) => ({
          author: c.author, video: videoTitle(c.videoId) || null, text: c.text.slice(0, 300), publishedAt: c.publishedAt,
          isNew: fresh.has(c.id), replies: c.replyCount,
        })),
        say: fresh.size ? t('say.newComments', { count: fresh.size }) : t('say.noNewComments'),
      };
    },

    draftReply: async (args: Record<string, unknown>) => {
      const text = str(args.text);
      if (!text) throw new Error('BAD_ARG: say the words of the reply');
      const threads = await readyThreads();
      const who = str(args.author);
      const video = str(args.video);
      if (!who && !video) throw new Error('BAD_ARG: name the comment by its author (and its video if the author wrote several)');
      let pool = threads;
      if (video) pool = threads.filter((c) => findNamedSafe([{ item: c, id: c.id, names: [videoTitle(c.videoId)], label: videoTitle(c.videoId) }], video));
      const thread = findNamed(pool.map((c) => commentNamed(c, videoTitle(c.videoId))), who || video, { code: 'NO_COMMENT', noun: 'comment' });
      if (!thread.canReply) throw new Error(`REPLY_CLOSED: replies are closed under the comment of ${thread.author}`);
      setReplyDraft(thread.id, text.slice(0, 5000));
      patchScreen({ focusThread: thread.id });
      showTab('channel');
      return { author: thread.author, drafted: true, sent: false, say: t('say.replyDrafted', { author: thread.author }) };
    },

    draftUpload: (args: Record<string, unknown>) => {
      const title = str(args.title);
      const description = str(args.description);
      if (!title && !description) throw new Error('BAD_ARG: give a title or a description for the video');
      patchUpload({ ...(title ? { title: title.slice(0, 100) } : {}), ...(description ? { description: description.slice(0, 5000) } : {}) });
      showTab('upload');
      return { drafted: true, sent: false, say: t('say.uploadDrafted') };
    },

    // The equalizer and the visualizer (doc 151 §10.4): bodies in soundAgent.ts.
    setEqualizer: (args: Record<string, unknown>) => setEqualizerAction(args),

    setVisualizer: (args: Record<string, unknown>) => setVisualizerAction(args),
    // agent-actions:end
  };
}

/** True when `ref` names this one entry (used to narrow comments by their video). */
function findNamedSafe<T>(entries: Array<Named<T>>, ref: string): boolean {
  try {
    findNamed(entries, ref, { code: 'NO', noun: 'x' });
    return true;
  } catch {
    // Not this video: the entry is left out of the pool, which is the point.
    return false;
  }
}
