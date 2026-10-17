/**
 * The exploded view keeps ONE player (doc 151 §13): each window here is its
 * own module graph (vi.resetModules), as each iframe is in the app, linked by
 * a fake channel that delivers like a BroadcastChannel (never to the sender,
 * after the current task).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock, Port, Role } from './sync';

type Win = Awaited<ReturnType<typeof windowOf>>;

let queue: Array<() => void> = [];
let ports: Array<{ ls: Set<(m: unknown) => void> }> = [];
let sent: Array<{ t: string; from: string }> = [];
let now = 1_000;
let timers: Array<{ at: number; every: number | null; fn: () => void; dead: boolean }> = [];

const clock: Clock = {
  now: () => now,
  every: (ms, fn) => { const tm = { at: now + ms, every: ms, fn, dead: false }; timers.push(tm); return () => { tm.dead = true; }; },
  after: (ms, fn) => { const tm = { at: now + ms, every: null, fn, dead: false }; timers.push(tm); return () => { tm.dead = true; }; },
};

function makePort(): Port & { ls: Set<(m: unknown) => void>; closed: boolean } {
  const ls = new Set<(m: unknown) => void>();
  const port = {
    ls,
    closed: false,
    post: (m: unknown) => {
      sent.push(m as { t: string; from: string });
      const copy = JSON.parse(JSON.stringify(m)) as unknown;
      for (const p of ports) if (p !== port && !(p as { closed?: boolean }).closed) queue.push(() => p.ls.forEach((fn) => fn(copy)));
    },
    listen: (fn: (m: unknown) => void) => { ls.add(fn); return () => { ls.delete(fn); }; },
    close: () => { port.closed = true; },
  };
  ports.push(port);
  return port;
}

async function flush() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
    const q = queue;
    queue = [];
    q.forEach((fn) => fn());
    await Promise.resolve();
    if (!queue.length) break;
  }
}

async function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    if (due.every) due.at += due.every; else due.dead = true;
    due.fn();
    await flush();
  }
  now = end;
  await flush();
}

/** One window: its own copy of every module, as an iframe has. */
async function windowOf(role: Role, id: string) {
  vi.resetModules();
  const sync = await import('./sync');
  const player = await import('./player');
  const screen = await import('./screen');
  const peer = await import('./peerSound');
  const graph = await import('./audioGraph');
  const events = { owner: [] as boolean[], gone: [] as boolean[], libs: [] as unknown[] };
  const port = makePort();
  const link = sync.linkWindows(role, port, {
    id, clock,
    onOwner: (o) => events.owner.push(o),
    onOwnerGone: (g) => events.gone.push(g),
    onLibrary: (l) => events.libs.push(l),
  });
  await flush();
  return { sync, player, screen, peer, graph, link, port, events, id };
}

const A = { kind: 'yt' as const, videoId: 'aaaaaaaaaaa', title: 'A' };
const B = { kind: 'yt' as const, videoId: 'bbbbbbbbbbb', title: 'B' };
const playingIn = (w: Win) => !w.player.isRemote() && w.link.isOwner();
const fromOf = (w: Win, t: string) => sent.filter((m) => m.t === t && m.from === w.id).length;

beforeEach(() => {
  queue = []; ports = []; sent = []; timers = []; now = 1_000;
  window.localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('one window plays, never two', () => {
  it('the single window plays at once', async () => {
    const main = await windowOf('main', 'm');
    expect(playingIn(main)).toBe(true);
  });

  it('the Player window takes over after its join wait; the single window yields and forwards', async () => {
    const main = await windowOf('main', 'm');
    main.player.playQueue([A, B], 0, { kind: 'single' });
    await flush();
    now += 10;
    const pw = await windowOf('player', 'p');
    expect(pw.link.isOwner()).toBe(false); // not before the answer or the wait
    await advance(450);
    expect(playingIn(pw)).toBe(true);
    expect(main.link.isOwner()).toBe(false);
    expect(main.player.isRemote()).toBe(true);
    expect(main.events.owner).toEqual([true, false]);
    // it took over what played, from where it was
    expect(pw.player.current()?.title).toBe('A');
    expect(pw.player.getPlayer().playing).toBe(true);
    // the old window's button now drives the new one
    main.player.pause();
    await flush();
    expect(pw.player.getPlayer().playing).toBe(false);
    expect(main.player.getPlayer().playing).toBe(false);
  });

  it('two owners for a moment: the newest claim wins, at once', async () => {
    const a = await windowOf('main', 'a');
    now += 5;
    const b = await windowOf('main', 'b');
    await advance(1100);
    expect([a.link.isOwner(), b.link.isOwner()]).toEqual([false, true]);
  });
});

describe('commands and state', () => {
  it('a play pressed in the Search window plays in the Player window, and every window shows it', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    const search = await windowOf('search', 's');
    const queueWin = await windowOf('queue', 'q');
    search.player.playQueue([A, B], 1, { kind: 'search', query: 'jazz' });
    expect(search.player.getPlayer().queue).toEqual([]); // nothing applied there: it is a command
    await flush();
    expect(pw.player.current()?.title).toBe('B');
    expect(queueWin.player.current()?.title).toBe('B');
    expect(search.player.getPlayer().from).toEqual({ kind: 'search', query: 'jazz' });
  });

  it('a window that only applies the state never sends one back (anti-echo)', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    const search = await windowOf('search', 's');
    pw.player.playQueue([A], 0, { kind: 'single' });
    await advance(3000);
    expect(fromOf(search, 'state')).toBe(0);
    expect(fromOf(pw, 'state')).toBeGreaterThan(2);
  });

  it('a message that does not read is dropped whole, never repaired', async () => {
    const search = await windowOf('search', 's');
    const evil = makePort();
    evil.post({ v: 1, from: 'x', t: 'state', at: 9e12, s: { queue: [{ kind: 'yt', videoId: 'nope', title: 'X' }], index: 0, playing: true, volume: 50, muted: false, from: null, error: null, position: null, duration: null } });
    evil.post({ v: 1, from: 'x', t: 'state', at: 9e12, s: { queue: [A], index: 0, playing: 'yes', volume: 50, muted: false, from: null, error: null, position: null, duration: null } });
    evil.post({ v: 1, from: 'x', t: 'bands', b: [1, 2, 3] });
    await flush();
    expect(search.player.getPlayer().queue).toEqual([]);
    const buf = new Float32Array(64);
    expect(search.peer.readPeerBands(buf)).toBe(false);
  });
});

describe('a window that went away', () => {
  it('the Player window closes: the single window takes over from the last state, another window says no one plays', async () => {
    const main = await windowOf('main', 'm');
    now += 10;
    const pw = await windowOf('player', 'p');
    await advance(450);
    const search = await windowOf('search', 's');
    pw.player.playQueue([A], 0, { kind: 'single' });
    pw.player.progress(42, 200);
    await advance(1100);
    pw.link.unlink();
    await advance(3200);
    expect(playingIn(main)).toBe(true);
    expect(main.player.getPlayer()).toMatchObject({ playing: true, resumeAt: 42 });
    // the search window hears the single window now: it is not left with a gone owner
    expect(search.events.gone.at(-1) ?? false).toBe(false);
  });

  it('no window can play any more: the others stop showing a song as playing', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    const queueWin = await windowOf('queue', 'q');
    pw.player.playQueue([A], 0, { kind: 'single' });
    await advance(1100);
    expect(queueWin.player.getPlayer().playing).toBe(true);
    pw.link.unlink();
    await advance(3200);
    expect(queueWin.events.gone).toEqual([true]);
    expect(queueWin.player.getPlayer().playing).toBe(false);
  });
});

describe('the Sound window', () => {
  it('gets bands only while it asks and a song is heard, as integers, never the sound', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    vi.spyOn(pw.graph, 'readBands').mockImplementation((out) => { out.fill(0.5); return true; });
    await advance(500);
    expect(fromOf(pw, 'bands')).toBe(0); // nobody asked
    const sound = await windowOf('sound', 'snd');
    await advance(200);
    expect(fromOf(pw, 'bands')).toBeGreaterThan(3);
    const buf = new Float32Array(64);
    expect(sound.peer.readPeerBands(buf)).toBe(true);
    expect(buf[0]).toBeCloseTo(128 / 255, 3);
    sound.link.unlink(); // stops asking
    await advance(2000);
    const before = fromOf(pw, 'bands');
    await advance(1000);
    expect(fromOf(pw, 'bands')).toBe(before);
  });
});

describe('the screen and the library travel', () => {
  it('a search shown in one window is shown in the others; a tab asked for opens in the window that holds it', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    const search = await windowOf('search', 's');
    const channel = await windowOf('channel', 'c');
    pw.screen.patchScreen({ search: { query: 'jazz', live: false, status: 'ready', results: [{ id: 'aaaaaaaaaaa', title: 'A', channel: 'Ch', thumbnail: null, live: false, publishedAt: null }], error: null } });
    await flush();
    expect(search.screen.getScreen().search.results.map((r) => r.id)).toEqual(['aaaaaaaaaaa']);
    pw.screen.showTab('channel');
    await flush();
    expect(channel.screen.getScreen().tab).toBe('channel');
    // applied without a send back
    expect(fromOf(search, 'screen')).toBe(0);
    expect(fromOf(channel, 'show')).toBe(0);
  });

  it('a window that opens is told what the screen holds', async () => {
    const pw = await windowOf('player', 'p');
    await advance(450);
    pw.screen.setReplyDraft('t1', 'merci');
    await flush();
    const channel = await windowOf('channel', 'c');
    await flush();
    expect(channel.screen.getScreen().replyDrafts).toEqual({ t1: 'merci' });
  });

  it('a library written in one window reaches the others', async () => {
    const a = await windowOf('queue', 'q');
    const b = await windowOf('channel', 'c');
    a.link.libraryWritten({ playlists: [] });
    await flush();
    expect(b.events.libs).toEqual([{ playlists: [] }]);
  });
});

describe('the hand-over', () => {
  it('a fresh snapshot is taken with the position moved on while it played; an old one is a past session', async () => {
    const w = await windowOf('queue', 'q');
    w.player.applyPeer({ queue: [A], index: 0, playing: true, volume: 60, muted: false, from: null, error: null, position: 30, duration: 100 });
    w.sync.saveHandover('player', 10_000);
    const h = w.sync.loadHandover('main', 15_000);
    expect(h?.wire.index).toBe(0);
    expect(h?.resumeAt).toBeCloseTo(35, 3);
    expect(w.sync.loadHandover('main', 10_000 + w.sync.HANDOVER_FRESH_MS + 1)).toBeNull();
    window.localStorage.setItem(w.sync.HANDOVER_KEY, '{nope');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(w.sync.loadHandover('main', 15_000)).toBeNull();
  });

  it('a snapshot the single window left as it closed is not taken back by a new single window (no song restarts by itself)', async () => {
    const w = await windowOf('queue', 'q');
    w.player.applyPeer({ queue: [A], index: 0, playing: true, volume: 60, muted: false, from: null, error: null, position: 30, duration: 100 });
    w.sync.saveHandover('main', 10_000);
    expect(w.sync.loadHandover('main', 11_000)).toBeNull();
    expect(w.sync.loadHandover('player', 11_000)?.wire.index).toBe(0);
    w.sync.saveHandover('board', 10_000);
    expect(w.sync.loadHandover('main', 11_000)?.wire.index).toBe(0);
  });

  it('the Sound window asks for bands only while it draws them', async () => {
    vi.resetModules();
    const sync = await import('./sync');
    let draws = false;
    sync.linkWindows('sound', makePort(), { id: 'snd', clock, wantsBands: () => draws });
    await advance(2100);
    expect(sent.filter((m) => m.t === 'want').length).toBe(0);
    draws = true;
    await advance(1000);
    expect(sent.filter((m) => m.t === 'want').length).toBe(1);
  });

  it('the Player window that hears nobody starts from the snapshot', async () => {
    const w0 = await windowOf('queue', 'q0');
    w0.player.applyPeer({ queue: [A, B], index: 1, playing: true, volume: 60, muted: false, from: null, error: null, position: 12, duration: 100 });
    w0.sync.saveHandover('board', Date.now());
    w0.link.unlink();
    const pw = await windowOf('player', 'p');
    pw.link.unlink();
    const pw2 = await (async () => {
      vi.resetModules();
      const sync = await import('./sync');
      const player = await import('./player');
      const link = sync.linkWindows('player', makePort(), { id: 'p2', clock, loadHandover: (r) => sync.loadHandover(r) });
      await advance(450);
      return { player, link };
    })();
    expect(pw2.link.isOwner()).toBe(true);
    expect(pw2.player.current()?.title).toBe('B');
    expect(pw2.player.getPlayer().resumeAt).toBeGreaterThanOrEqual(12);
  });
});

describe('which window is which', () => {
  it('reads ?widget=, and anything else is the single window', async () => {
    const { roleOf, WIDGET_OF } = await import('./sync');
    expect(roleOf('?widget=mnemo-youtube-sound')).toBe('sound');
    expect(roleOf('?widget=mnemo-youtube-player&x=1')).toBe('player');
    expect(roleOf('?widget=mnemo-clio-map')).toBe('main');
    expect(roleOf('')).toBe('main');
    expect(Object.keys(WIDGET_OF).sort()).toEqual(['channel', 'player', 'queue', 'search', 'sound']);
  });
});
