/**
 * ytEmbed.ts — the YouTube player driven by its own postMessage protocol
 * (doc 151 §2).
 *
 * ⛔ No `iframe_api` script: a third-party script in this page would run with
 * this cartridge's bridge to the host. The player frame speaks a small JSON
 * protocol on its own: we say `listening`, it answers `onReady` and
 * `infoDelivery` (state, time, volume), and takes `command` messages.
 * Messages are accepted only from THAT frame and THAT origin.
 *
 * ⛔ The player stays visible (YouTube's terms): this file never hides it,
 * never extracts a stream.
 */

export const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
/**
 * The player that reads a YouTube sign-in (doc 151 §16). `nocookie` never
 * sends the account's cookies, so once the sign-in wall has been met the
 * player moves here, where a sign-in made in the app's window counts.
 */
export const SIGNED_IN_ORIGIN = 'https://www.youtube.com';

const HOST_KEY = 'mnemo-youtube:embed-origin';

/** The origin the player uses: nocookie until the wall has been met on this machine. */
export function readEmbedOrigin(store: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  try {
    return store?.getItem(HOST_KEY) === SIGNED_IN_ORIGIN ? SIGNED_IN_ORIGIN : EMBED_ORIGIN;
  } catch (err) {
    console.warn('[youtube] player origin not read, nocookie kept:', err);
    return EMBED_ORIGIN;
  }
}

/** Remembers that the player must use the origin that carries a sign-in. */
export function rememberSignedInOrigin(store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    store?.setItem(HOST_KEY, SIGNED_IN_ORIGIN);
  } catch (err) {
    console.warn('[youtube] player origin not remembered (used for this session only):', err);
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } // blocked storage: the default origin stands
}

/** The player's own states, as it reports them. */
export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** `start` (whole seconds) takes over a video another window was playing (doc 151 §13). */
export function embedUrl(videoId: string, pageOrigin: string, autoplay: boolean, start: number | null = null, origin: string = EMBED_ORIGIN): string {
  const q = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', origin: pageOrigin, autoplay: autoplay ? '1' : '0' });
  if (start !== null && Number.isFinite(start) && start >= 1) q.set('start', String(Math.floor(start)));
  return `${origin}/embed/${encodeURIComponent(videoId)}?${q.toString()}`;
}

export interface PlayerNews {
  ready?: true;
  state?: number;
  time?: number;
  duration?: number;
  error?: number;
  /**
   * YouTube put its « sign in to confirm you're not a bot » wall over the
   * video. Measured 2026-10-16: the frame sends NO `onError` for it, only
   * `onReady` then `infoDelivery` with `videoData.errorCode: "auth"`, so
   * without this the store kept « playing » at 0:00 with nothing said.
   */
  signInWall?: true;
}

/** One message of the player frame, or null for anything else. */
export function readPlayerMessage(data: unknown): PlayerNews | null {
  let d: unknown = data;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; } // not the player's JSON: ignored, nothing to say
  }
  if (!d || typeof d !== 'object') return null;
  const m = d as { event?: unknown; info?: unknown };
  if (m.event === 'onReady' || m.event === 'initialDelivery') return { ready: true };
  if (m.event === 'onError') return typeof m.info === 'number' ? { error: m.info } : null;
  if (m.event === 'onStateChange') return typeof m.info === 'number' ? { state: m.info } : null;
  if (m.event === 'infoDelivery' && m.info && typeof m.info === 'object') {
    const i = m.info as Record<string, unknown>;
    const out: PlayerNews = {};
    if (typeof i.playerState === 'number') out.state = i.playerState;
    if (typeof i.currentTime === 'number' && Number.isFinite(i.currentTime)) out.time = i.currentTime;
    if (typeof i.duration === 'number' && Number.isFinite(i.duration) && i.duration > 0) out.duration = i.duration;
    const vd = i.videoData as { errorCode?: unknown } | undefined;
    if (vd && typeof vd === 'object' && vd.errorCode === 'auth') out.signInWall = true;
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/** The player's error numbers → this cartridge's codes (each has a sentence on screen). */
export function playerErrorCode(n: number): string {
  if (n === 2) return 'BAD_VIDEO_ID';
  if (n === 5) return 'PLAYER_FAILED';
  if (n === 100) return 'VIDEO_NOT_FOUND';
  if (n === 101 || n === 150) return 'NOT_EMBEDDABLE';
  // The embed identity error measured in lot 0: the host's Referer rule did not reach this frame.
  if (n === 153) return 'PLAYER_IDENTITY';
  return 'PLAYER_FAILED';
}

/**
 * The wall is YouTube's, not this player's: measured the same day on
 * youtube.com/watch itself (`playabilityStatus: LOGIN_REQUIRED`), from the
 * same network, outside any embed. Its « Se connecter » opens a sign-in window
 * of the app (host, doc 151 §16), then « Réessayer » reloads the player on
 * youtube.com, which reads that sign-in. The other way out is the video on
 * youtube.com in the person's own browser.
 */
export const SIGN_IN_WALL = 'YT_SIGN_IN_WALL';

/**
 * The link the wall itself carries (measured 2026-10-16). The wall's own button
 * cannot open it: a cartridge frame has no `allow-popups`, and the player
 * inside inherits that sandbox. The cartridge's button sends it to the host,
 * which opens its sign-in window on the player's session (doc 151 §16).
 */
export const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue';

export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

export const listening = (): string => JSON.stringify({ event: 'listening', id: 'mnemo-player', channel: 'widget' });
export const command = (func: string, args: unknown[] = []): string => JSON.stringify({ event: 'command', func, args });
