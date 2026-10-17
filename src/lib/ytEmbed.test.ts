import { describe, expect, it } from 'vitest';
import { EMBED_ORIGIN, embedUrl, readEmbedOrigin, readPlayerMessage, rememberSignedInOrigin, SIGNED_IN_ORIGIN, watchUrl } from './ytEmbed';

// The frames below are the shape measured on 2026-10-16 (doc 151 §15): the
// sign-in wall sends no onError, only infoDelivery with videoData.errorCode.
const delivery = (info: Record<string, unknown>) => JSON.stringify({ event: 'infoDelivery', info, channel: 'widget', id: 'mnemo-player' });

describe('readPlayerMessage › sign-in wall', () => {
  it('reads errorCode "auth" as the wall, with the time and duration that came with it', () => {
    const news = readPlayerMessage(delivery({ playerState: -1, currentTime: 0, duration: 4373, videoData: { video_id: 'abc', errorCode: 'auth' } }));
    expect(news).toEqual({ state: -1, time: 0, duration: 4373, signInWall: true });
  });

  it('a delivery whose videoData carries no error is not the wall', () => {
    expect(readPlayerMessage(delivery({ playerState: 1, videoData: { errorCode: null } }))?.signInWall).toBeUndefined();
  });

  it('only "auth" is the wall: another error code is left to onError', () => {
    expect(readPlayerMessage(delivery({ playerState: -1, videoData: { errorCode: 'embedder.identity.denied' } }))?.signInWall).toBeUndefined();
  });

  it('a delivery with nothing but the wall is still read', () => {
    expect(readPlayerMessage(delivery({ videoData: { errorCode: 'auth' } }))).toEqual({ signInWall: true });
  });
});

describe('watchUrl', () => {
  it('points at the video on youtube.com, id encoded', () => {
    expect(watchUrl('jNQXAC9IVRw')).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    expect(watchUrl('a&b')).toBe('https://www.youtube.com/watch?v=a%26b');
  });
});

describe('player origin (doc 151 §16)', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

  it('is nocookie until the wall has been met, youtube.com after', () => {
    const store = memory();
    expect(readEmbedOrigin(store)).toBe(EMBED_ORIGIN);
    rememberSignedInOrigin(store);
    expect(readEmbedOrigin(store)).toBe(SIGNED_IN_ORIGIN);
  });

  it('a storage that throws keeps nocookie, and a failed write does not throw', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readEmbedOrigin(broken)).toBe(EMBED_ORIGIN);
    expect(() => rememberSignedInOrigin(broken)).not.toThrow();
  });

  it('embedUrl builds on the origin it is given', () => {
    expect(embedUrl('abc', 'http://x', false, null, SIGNED_IN_ORIGIN).startsWith('https://www.youtube.com/embed/abc?')).toBe(true);
    expect(embedUrl('abc', 'http://x', false).startsWith('https://www.youtube-nocookie.com/embed/abc?')).toBe(true);
  });
});
