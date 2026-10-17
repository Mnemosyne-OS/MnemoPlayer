/**
 * sync.ts — the windows of one MnemoPlayer share ONE player (doc 151 §13, the
 * exploded view of doc 143): the Player window plays, the Queue, Sound,
 * Search and Channel windows show their part and send it their commands.
 *
 * Over a BroadcastChannel named after MnemoPlayer. Installed, every cartridge
 * shares one origin, so EVERY message is read as untrusted: a field that does
 * not read drops the whole message, never repaired into a value nobody sent.
 *
 * The rules (doc 143 §5, MnemoClio's, adapted to sound):
 *  - 🚨 ONE window plays: the owner. Only the windows that CAN play (the single
 *    window `main`, and the `player` window) ever own; the newest one that
 *    claims wins (`at`, then `id`), the older one yields: its players unmount
 *    and its controls forward commands. Never two players playing.
 *  - The owner says what plays (`state`) on every change and once a second;
 *    the others apply it WITHOUT sending it back (anti-echo: only the owner
 *    sends state). Silent for OWNER_SILENCE_MS (its window closed): a window
 *    that can play takes over from the last state; any other shows nothing
 *    playing rather than a player standing still forever.
 *  - A window that opens says `hello`; the owner answers with what plays and
 *    what the screen holds. The `player` window waits JOIN_WAIT_MS for that
 *    answer before it plays (else it starts from the hand-over snapshot), so it
 *    never mounts empty and then remounts.
 *  - Commands (`cmd`) go to the owner, which applies them with the SAME player
 *    functions as its own buttons.
 *  - The screen's shared parts (search, reply drafts, upload form) and a tab
 *    asked for (`show`) travel from whichever window changed them; the
 *    library travels whole after a write (`lib`), and is re-normalised.
 *  - The Sound window has no analyser: it asks (`want`) and the owner sends
 *    its 64 bands as integers while a song is heard, never the sound.
 */
import { getGraphState, readBands, subscribeGraph, type GraphState } from './audioGraph';
import { normalizeItem, type Item } from './library';
import { setPeerBands, setPeerGraph } from './peerSound';
import * as player from './player';
import { BAND_COUNT } from './spectrumBands';
import { getScreen, patchScreen, showTab, setShowListener, subscribeScreen, TABS, type ScreenState, type SearchHit, type Tab, type UploadDraft } from './screen';

export const SYNC_CHANNEL = 'mnemo-youtube.sync.v1';
/** A `player` window waits this long for the window that played before it starts. */
export const JOIN_WAIT_MS = 400;
/** The owner's state comes at least this often. */
export const HEARTBEAT_MS = 1000;
/** No word from the owner this long: its window is gone. */
export const OWNER_SILENCE_MS = 2500;
/** The Sound window asks for bands this often; the owner sends them while the last ask is this fresh. */
export const WANT_EVERY_MS = 1000;
export const WANT_FRESH_MS = 1600;
/** Bands at ~30 frames a second. */
export const BANDS_EVERY_MS = 33;

/** The windows MnemoPlayer can be (`?widget=`); the single window is `main`. */
export const ROLES = ['main', 'player', 'queue', 'sound', 'search', 'channel'] as const;
export type Role = (typeof ROLES)[number];

export const WIDGET_OF: Record<Exclude<Role, 'main'>, string> = {
  player: 'mnemo-youtube-player',
  queue: 'mnemo-youtube-queue',
  sound: 'mnemo-youtube-sound',
  search: 'mnemo-youtube-search',
  channel: 'mnemo-youtube-channel',
};

/** `?widget=mnemo-youtube-sound` → 'sound'; anything else (the single window, a plain browser) → 'main'. */
export function roleOf(search: string): Role {
  const w = new URLSearchParams(search).get('widget');
  const hit = (Object.entries(WIDGET_OF) as Array<[Role, string]>).find(([, id]) => id === w);
  return hit ? hit[0] : 'main';
}

export const canPlay = (r: Role): boolean => r === 'main' || r === 'player';

// ── Reading messages (untrusted) ─────────────────────────────────────────

type Wire = Omit<player.PlayerState, 'ducked' | 'resumeAt'>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length <= max;
const CODE = /^[A-Z][A-Z0-9_]{1,40}$/;
const MAX_QUEUE = 600;

function readItems(v: unknown): Item[] | null {
  if (!Array.isArray(v) || v.length > MAX_QUEUE) return null;
  const out: Item[] = [];
  for (const raw of v) {
    const it = normalizeItem(raw);
    if (!it) return null;
    out.push(it);
  }
  return out;
}

function readFrom(v: unknown): player.QueueSource | null | undefined {
  if (v === null) return null;
  const f = v as Record<string, unknown> | null;
  if (!f || typeof f !== 'object') return undefined;
  if (f.kind === 'playlist') return isStr(f.name, 120) ? { kind: 'playlist', name: f.name } : undefined;
  if (f.kind === 'search') return isStr(f.query, 200) ? { kind: 'search', query: f.query } : undefined;
  if (f.kind === 'music' || f.kind === 'channel' || f.kind === 'single') return { kind: f.kind };
  return undefined;
}

const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : isNum(v) && v >= 0 ? v : undefined);

/** What the owner says plays, or null when one field does not read. */
export function readWire(o: unknown): Wire | null {
  const s = o as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const queue = readItems(s.queue);
  const from = readFrom(s.from);
  const position = numOrNull(s.position);
  const duration = numOrNull(s.duration);
  if (!queue || from === undefined || position === undefined || duration === undefined) return null;
  if (!Number.isInteger(s.index) || (s.index as number) < -1 || (s.index as number) >= queue.length) return null;
  if (typeof s.playing !== 'boolean' || typeof s.muted !== 'boolean') return null;
  if (!isNum(s.volume) || s.volume < 0 || s.volume > 100) return null;
  if (s.error !== null && !(typeof s.error === 'string' && CODE.test(s.error))) return null;
  return {
    queue, index: s.index as number, playing: s.playing, volume: s.volume, muted: s.muted, from,
    error: s.error, position, duration,
  };
}

function wireOf(s: player.PlayerState): Wire {
  return { queue: s.queue, index: s.index, playing: s.playing, volume: s.volume, muted: s.muted, from: s.from, error: s.error, position: s.position, duration: s.duration };
}

const GRAPH_STATES: readonly GraphState[] = ['idle', 'live', 'blocked', 'unavailable'];

/** A command for the owner, or null. */
export function readCommand(o: unknown): player.PlayerCommand | null {
  const c = o as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') return null;
  switch (c.op) {
    case 'play': case 'pause': case 'next': case 'previous': return { op: c.op };
    case 'setVolume': return isNum(c.volume) ? { op: 'setVolume', volume: c.volume } : null;
    case 'setMuted': return typeof c.muted === 'boolean' ? { op: 'setMuted', muted: c.muted } : null;
    case 'playQueue': {
      const items = readItems(c.items);
      const from = readFrom(c.from);
      if (!items || !items.length || !from || !isNum(c.start)) return null;
      return { op: 'playQueue', items, start: c.start, from };
    }
    default: return null;
  }
}

/** Applies a command with the owner's own player functions. A refusal (nothing to play) is the owner's to keep. */
export function applyCommand(c: player.PlayerCommand): void {
  try {
    switch (c.op) {
      case 'playQueue': player.playQueue(c.items, c.start, c.from); break;
      case 'play': player.play(); break;
      case 'pause': player.pause(); break;
      case 'next': player.next(); break;
      case 'previous': player.previous(); break;
      case 'setVolume': player.setVolume(c.volume); break;
      case 'setMuted': player.setMuted(c.muted); break;
    }
  } catch (err) {
    console.warn('[youtube] a command from another window could not be applied:', c.op, err instanceof Error ? err.message : err);
  }
}

/** The screen's shared parts. */
type ScreenShare = Pick<ScreenState, 'search' | 'replyDrafts' | 'focusThread' | 'upload'>;
const shareOf = (s: ScreenState): ScreenShare => ({ search: s.search, replyDrafts: s.replyDrafts, focusThread: s.focusThread, upload: s.upload });

function readHit(o: unknown): SearchHit | null {
  const h = o as Record<string, unknown> | null;
  if (!h || typeof h !== 'object' || !isStr(h.id, 20) || !/^[A-Za-z0-9_-]{11}$/.test(h.id)) return null;
  if (!isStr(h.title) || !isStr(h.channel) || typeof h.live !== 'boolean') return null;
  if (h.thumbnail !== null && !(isStr(h.thumbnail, 500) && /^https:\/\//.test(h.thumbnail))) return null;
  if (h.publishedAt !== null && !isStr(h.publishedAt, 40)) return null;
  return { id: h.id, title: h.title, channel: h.channel, live: h.live, thumbnail: h.thumbnail, publishedAt: h.publishedAt };
}

/** The screen's shared parts from a message, or null. */
export function readShare(o: unknown): ScreenShare | null {
  const s = o as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const q = s.search as Record<string, unknown> | null;
  if (!q || typeof q !== 'object' || !isStr(q.query, 200) || typeof q.live !== 'boolean') return null;
  if (!['idle', 'loading', 'ready', 'error'].includes(q.status as string)) return null;
  if (q.error !== null && !(typeof q.error === 'string' && CODE.test(q.error))) return null;
  if (!Array.isArray(q.results) || q.results.length > 50) return null;
  const results = q.results.map(readHit);
  if (results.some((r) => r === null)) return null;
  const d = s.replyDrafts as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || Object.keys(d).length > 100) return null;
  const replyDrafts: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!isStr(k, 100) || !isStr(v, 5000)) return null;
    replyDrafts[k] = v;
  }
  if (s.focusThread !== null && !isStr(s.focusThread, 100)) return null;
  const u = s.upload as Record<string, unknown> | null;
  if (!u || typeof u !== 'object' || !isStr(u.title, 100) || !isStr(u.description, 5000)) return null;
  if (u.madeForKids !== null && typeof u.madeForKids !== 'boolean') return null;
  let file: UploadDraft['file'] = null;
  if (u.file !== null) {
    const f = u.file as Record<string, unknown> | null;
    if (!f || typeof f !== 'object' || !isStr(f.id, 100) || !isStr(f.name, 300) || !isNum(f.size)) return null;
    file = { id: f.id, name: f.name, size: f.size };
  }
  return {
    search: { query: q.query, live: q.live, status: q.status as ScreenState['search']['status'], results: results as SearchHit[], error: q.error },
    replyDrafts,
    focusThread: s.focusThread,
    upload: { title: u.title, description: u.description, madeForKids: u.madeForKids, file },
  };
}

function readBandsMsg(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== BAND_COUNT) return null;
  return v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? (v as number[]) : null;
}

// ── The channel ──────────────────────────────────────────────────────────

/** The channel, as the link needs it (a BroadcastChannel, or a fake in tests). */
export interface Port {
  post(m: unknown): void;
  listen(fn: (m: unknown) => void): () => void;
  close(): void;
}

/** The real channel, or null where there is none (each window then stands alone). */
export function broadcastPort(name = SYNC_CHANNEL): Port | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(name);
  return {
    post: (m) => {
      try { ch.postMessage(m); } catch (e) { console.warn('[youtube] a sync message could not go out', e); }
    },
    listen: (fn) => {
      const on = (ev: MessageEvent) => fn(ev.data);
      ch.addEventListener('message', on);
      return () => ch.removeEventListener('message', on);
    },
    close: () => ch.close(),
  };
}

export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
}
const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => { const h = setInterval(fn, ms); return () => clearInterval(h); },
  after: (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
};

export interface LinkDeps {
  id?: string;
  clock?: Clock;
  /** The library a peer wrote (already a message's field), for the library store. */
  onLibrary?: (raw: unknown) => void;
  /**
   * Hand-over snapshot: what the window that played left, when nobody answers.
   * `role` is who reads it: the single window takes only what a board left
   * (see loadHandover), so closing and reopening it never restarts a song.
   */
  loadHandover?: (role: Role) => { wire: Wire; resumeAt: number | null } | null;
  /** The Sound window asks for bands only while it draws them (visualizer on, panel open). */
  wantsBands?: () => boolean;
  /** The owner writes what plays for a window that will take over (throttled to once a second). */
  saveHandover?: () => void;
  /** Called on every owner change (the UI unmounts or mounts its players). */
  onOwner?: (owner: boolean) => void;
  /** No window plays any more (a window that cannot play lost the owner). */
  onOwnerGone?: (gone: boolean) => void;
}

export interface Link {
  isOwner(): boolean;
  /** This window wrote the library: the others take it. */
  libraryWritten(lib: unknown): void;
  unlink(): void;
}

/**
 * Links this window to the others. Returns the link; `unlink` stops every
 * timer and listener and gives the player back to this window alone.
 */
export function linkWindows(role: Role, port: Port, deps: LinkDeps = {}): Link {
  const id = deps.id ?? Math.random().toString(36).slice(2);
  const clock = deps.clock ?? realClock;
  const playable = canPlay(role);
  const at = clock.now();
  let owner = false;
  let ownerGone = false;
  let lastOwnerWord = clock.now();
  let applyingScreen = false;
  let lastShareKey = JSON.stringify(shareOf(getScreen()));
  let wantedAt = -Infinity;
  let stopBands: (() => void) | null = null;
  const bandBuf = new Float32Array(BAND_COUNT);

  const send = (t: string, body: Record<string, unknown> = {}) => port.post({ v: 1, from: id, t, ...body });
  let savedAt = -Infinity;
  // A change is saved at most once a second; an unchanged player only every 30 s, to keep the snapshot fresh.
  const sendState = (changed = true) => {
    send('state', { s: wireOf(player.getPlayer()), at, graph: getGraphState() });
    const gap = clock.now() - savedAt;
    if (deps.saveHandover && gap >= (changed ? 1000 : 30_000)) { savedAt = clock.now(); deps.saveHandover(); }
  };
  const sendShare = () => send('screen', { p: shareOf(getScreen()) });

  const setGone = (gone: boolean) => {
    if (gone === ownerGone) return;
    ownerGone = gone;
    deps.onOwnerGone?.(gone);
  };

  const becomeOwner = () => {
    if (owner) return;
    owner = true;
    player.setForward(null);
    setGone(false);
    setPeerGraph(null);
    deps.onOwner?.(true);
    sendState();
  };
  const yieldOwner = () => {
    player.setForward((cmd) => send('cmd', { c: cmd }));
    if (!owner) return;
    owner = false;
    deps.onOwner?.(false);
  };

  // Every window starts as a remote; a window that can play claims below.
  player.setForward((cmd) => send('cmd', { c: cmd }));

  let pendingState = false;
  const offPlayer = player.subscribePlayer(() => {
    if (!owner || pendingState) return;
    pendingState = true;
    queueMicrotask(() => { pendingState = false; if (owner) sendState(); });
  });
  const offGraph = subscribeGraph(() => { if (owner) sendState(); });

  const offScreen = subscribeScreen(() => {
    if (applyingScreen) return;
    const key = JSON.stringify(shareOf(getScreen()));
    if (key === lastShareKey) return;
    lastShareKey = key;
    sendShare();
  });
  setShowListener((tab) => send('show', { tab }));

  const bandsTick = () => {
    if (!owner || clock.now() - wantedAt > WANT_FRESH_MS) { stopBands?.(); stopBands = null; return; }
    if (!readBands(bandBuf)) return;
    send('bands', { b: Array.from(bandBuf, (x) => Math.max(0, Math.min(255, Math.round(x * 255)))) });
  };

  const off = port.listen((raw) => {
    const m = raw as Record<string, unknown> | null;
    if (!m || m.v !== 1 || typeof m.from !== 'string' || m.from === id || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello':
        if (owner) { sendState(false); sendShare(); }
        return;
      case 'state': {
        const w = readWire(m.s);
        if (!w || !isNum(m.at)) return;
        if (owner) {
          // two owners for a moment: the newest claim plays, the other yields
          const newer = m.at > at || (m.at === at && m.from > id);
          if (!newer) { sendState(); return; }
          yieldOwner();
        }
        lastOwnerWord = clock.now();
        setGone(false);
        player.applyPeer(w);
        setPeerGraph(GRAPH_STATES.includes(m.graph as GraphState) ? (m.graph as GraphState) : null);
        return;
      }
      case 'cmd': {
        if (!owner) return;
        const c = readCommand(m.c);
        if (c) applyCommand(c);
        return;
      }
      case 'screen': {
        const p = readShare(m.p);
        if (!p) return;
        lastShareKey = JSON.stringify(p);
        applyingScreen = true;
        try { patchScreen(p); } finally { applyingScreen = false; }
        return;
      }
      case 'show':
        if ((TABS as readonly string[]).includes(m.tab as string)) showTab(m.tab as Tab, { fromPeer: true });
        return;
      case 'lib':
        deps.onLibrary?.(m.lib);
        return;
      case 'want':
        if (!owner) return;
        wantedAt = clock.now();
        if (!stopBands) stopBands = clock.every(BANDS_EVERY_MS, bandsTick);
        return;
      case 'bands': {
        if (owner) return;
        const b = readBandsMsg(m.b);
        if (b) setPeerBands(b);
        return;
      }
      default:
    }
  });

  const offBeat = clock.every(HEARTBEAT_MS, () => { if (owner) sendState(false); });
  // The window that played went away: one that can play takes over from the last state, another shows nothing playing.
  const offWatch = clock.every(500, () => {
    if (owner || clock.now() - lastOwnerWord <= OWNER_SILENCE_MS) return;
    if (playable) {
      const s = player.getPlayer();
      player.applyPeer(wireOf(s), s.position);
      becomeOwner();
    } else if (!ownerGone) {
      setGone(true);
      setPeerGraph(null);
      player.applyPeer({ ...wireOf(player.getPlayer()), playing: false });
    }
  });
  const askBands = () => { if (deps.wantsBands?.() ?? true) send('want'); };
  const offWant = role === 'sound' ? clock.every(WANT_EVERY_MS, askBands) : () => undefined;
  if (role === 'sound') askBands();

  let offJoin: () => void = () => undefined;
  let heard = false;
  const offHeard = port.listen((raw) => {
    const m = raw as Record<string, unknown> | null;
    if (m && m.v === 1 && m.t === 'state' && m.from !== id) heard = true;
  });

  send('hello');
  if (role === 'main') {
    // The single window plays at once (nothing to wait for alone), from a hand-over if one is fresh.
    const h = deps.loadHandover?.(role);
    if (h) player.applyPeer(h.wire, h.resumeAt);
    becomeOwner();
  } else if (role === 'player') {
    offJoin = clock.after(JOIN_WAIT_MS, () => {
      if (heard) {
        // the window that played answered: take over from where it is
        const s = player.getPlayer();
        player.applyPeer(wireOf(s), s.position);
      } else {
        const h = deps.loadHandover?.(role);
        if (h) player.applyPeer(h.wire, h.resumeAt);
      }
      becomeOwner();
    });
  } else {
    // a window that cannot play starts from the hand-over so it is not blank for a beat
    const h = deps.loadHandover?.(role);
    if (h) player.applyPeer({ ...h.wire, playing: false });
  }

  return {
    isOwner: () => owner,
    libraryWritten: (lib) => send('lib', { lib }),
    unlink: () => {
      off(); offHeard(); offPlayer(); offGraph(); offScreen(); offBeat(); offWatch(); offWant(); offJoin();
      stopBands?.();
      setShowListener(null);
      player.setForward(null);
      setPeerGraph(null);
      port.close();
    },
  };
}

// ── The hand-over snapshot ───────────────────────────────────────────────

export const HANDOVER_KEY = 'mnemo-youtube:handover';
/** A snapshot older than this is a past session, not a hand-over: a fresh launch never resumes a song by itself. */
export const HANDOVER_FRESH_MS = 60_000;

/** Who wrote a snapshot: a window's role, or `board` for a press on « Exploded view » / « Single view ». */
export type HandoverBy = Role | 'board';

/**
 * The window that plays writes what plays, for the window that takes over
 * when it closes (the board opens on its own desktop, or the single window
 * comes back): saved on a board press, on a change, and when the page hides.
 */
export function saveHandover(by: HandoverBy, now = Date.now()): void {
  try {
    window.localStorage.setItem(HANDOVER_KEY, JSON.stringify({ at: now, by, s: wireOf(player.getPlayer()) }));
  } catch (err) {
    console.warn('[youtube] what plays could not be handed over:', err);
  }
}

/**
 * A fresh snapshot for the window `reader`. 🚨 The single window takes back
 * only what a BOARD left (a board press, or a window of the board that played):
 * a snapshot it wrote itself as it closed is not a hand-over, and taking it
 * would restart a song nobody asked for when MnemoPlayer is reopened.
 */
export function loadHandover(reader: Role, now = Date.now()): { wire: Wire; resumeAt: number | null } | null {
  try {
    const raw = window.localStorage.getItem(HANDOVER_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!isNum(o.at) || now - o.at > HANDOVER_FRESH_MS || o.at > now + 5000) return null;
    if (reader === 'main' && o.by !== 'board' && o.by !== 'player') return null;
    const wire = readWire(o.s);
    if (!wire) return null;
    // the position of a playing item moved on while nobody watched
    const resumeAt = wire.position === null ? null : wire.position + (wire.playing ? Math.max(0, (now - o.at) / 1000) : 0);
    return { wire, resumeAt };
  } catch (err) {
    console.warn('[youtube] the hand-over could not be read:', err);
    return null;
  }
}
