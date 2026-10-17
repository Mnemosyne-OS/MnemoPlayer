/**
 * The player's wiring (doc 151 §2-§3): the YouTube frame is on screen, answers
 * only its own frame and origin, obeys the store (a spoken « pause » is the
 * same store change as the button) and moves on at the end of a video.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerView } from './PlayerView';
import * as player from '../lib/player';
import { EMBED_ORIGIN } from '../lib/ytEmbed';

const A = { kind: 'yt' as const, videoId: 'aaaaaaaaaaa', title: 'Video A' };
const B = { kind: 'yt' as const, videoId: 'bbbbbbbbbbb', title: 'Video B' };

function frameWindow() {
  const frame = document.querySelector('iframe');
  if (!frame?.contentWindow) throw new Error('no YouTube frame on screen');
  return { frame, win: frame.contentWindow };
}
function fromPlayer(data: unknown, origin = EMBED_ORIGIN, source?: Window | null) {
  const { win } = frameWindow();
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin, source: source ?? win })); });
}

beforeEach(() => player.__resetPlayerForTests());
afterEach(() => vi.restoreAllMocks());

describe('the visible YouTube player', () => {
  it('shows the no-cookie embed with the protocol on, visible', () => {
    player.playQueue([A, B], 0, { kind: 'single' });
    render(<PlayerView />);
    const { frame } = frameWindow();
    expect(frame.src.startsWith(`${EMBED_ORIGIN}/embed/aaaaaaaaaaa?`)).toBe(true);
    expect(frame.src).toContain('enablejsapi=1');
    expect(screen.getByText('Video A')).toBeInTheDocument();
  });

  it('obeys the store and follows the frame, only from ITS frame and origin', () => {
    player.playQueue([A, B], 0, { kind: 'single' });
    render(<PlayerView />);
    const { win } = frameWindow();
    const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
    fromPlayer({ event: 'onReady' });
    expect(post.mock.calls.map((c) => c[0])).toContain(JSON.stringify({ event: 'command', func: 'setVolume', args: [80] }));
    fromPlayer({ event: 'infoDelivery', info: { playerState: 1 } });
    // A spoken « pause » is this store change; the frame is told.
    act(() => player.pause());
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), EMBED_ORIGIN);
    // A message from another origin, or another window, changes nothing.
    fromPlayer({ event: 'infoDelivery', info: { playerState: 0 } }, 'https://evil.example');
    fromPlayer({ event: 'infoDelivery', info: { playerState: 0 } }, EMBED_ORIGIN, window);
    expect(player.getPlayer().index).toBe(0);
    // The end of the video moves the list on.
    fromPlayer({ event: 'infoDelivery', info: { playerState: 0 } });
    expect(player.getPlayer().index).toBe(1);
  });

  it('a video its owner keeps off other sites is said, and the list stops', () => {
    player.playQueue([A], 0, { kind: 'single' });
    render(<PlayerView />);
    fromPlayer({ event: 'onError', info: 150 });
    expect(player.getPlayer()).toMatchObject({ playing: false, error: 'NOT_EMBEDDABLE' });
  });

  it('the buttons are the store', () => {
    player.playQueue([A, B], 0, { kind: 'single' });
    render(<PlayerView />);
    fireEvent.click(screen.getByLabelText('Next'));
    expect(player.getPlayer().index).toBe(1);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(player.getPlayer().playing).toBe(false);
  });
});

describe('the orb lowers the music (field 2026-10-13: Whisper heard the songs)', () => {
  const vol = (v: number) => JSON.stringify({ event: 'command', func: 'setVolume', args: [v] });
  const lastVolume = (post: ReturnType<typeof vi.spyOn>) =>
    post.mock.calls.map((c) => c[0]).filter((m) => String(m).includes('setVolume')).at(-1);

  it('goes down to 15 % while the orb is active, then back to the person’s volume', () => {
    player.playQueue([A], 0, { kind: 'single' });
    render(<PlayerView />);
    const post = vi.spyOn(frameWindow().win, 'postMessage').mockImplementation(() => {});
    fromPlayer({ event: 'onReady' });
    act(() => player.setDucked(true));
    expect(lastVolume(post)).toBe(vol(12));
    act(() => player.setDucked(false));
    expect(lastVolume(post)).toBe(vol(80));
  });

  it('a volume the person sets during the duck is the one that comes back', () => {
    player.playQueue([A], 0, { kind: 'single' });
    render(<PlayerView />);
    const post = vi.spyOn(frameWindow().win, 'postMessage').mockImplementation(() => {});
    fromPlayer({ event: 'onReady' });
    act(() => player.setDucked(true));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '60' } });
    expect(lastVolume(post)).toBe(vol(9));
    // The slider shows the person's number, not the lowered one.
    expect(screen.getByLabelText<HTMLInputElement>('Volume').value).toBe('60');
    act(() => player.setDucked(false));
    expect(lastVolume(post)).toBe(vol(60));
  });

  it('a frame that becomes ready during the duck starts low', () => {
    player.playQueue([A], 0, { kind: 'single' });
    act(() => player.setDucked(true));
    render(<PlayerView />);
    const post = vi.spyOn(frameWindow().win, 'postMessage').mockImplementation(() => {});
    fromPlayer({ event: 'onReady' });
    expect(lastVolume(post)).toBe(vol(12));
  });
});
