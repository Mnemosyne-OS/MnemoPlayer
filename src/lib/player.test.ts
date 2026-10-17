/** The duck under the orb (field 2026-10-13): the flag moves, the person's volume never does. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as player from './player';
const A = { kind: 'yt' as const, videoId: 'aaaaaaaaaaa', title: 'A' };const B = { kind: 'yt' as const, videoId: 'bbbbbbbbbbb', title: 'B' };

beforeEach(() => player.__resetPlayerForTests());

describe('ducking under the orb', () => {
  it('plays at DUCK_RATIO of the person\'s volume and leaves that volume intact', () => {
    player.setVolume(80);
    player.setDucked(true);
    expect(player.getPlayer().volume).toBe(80);
    expect(player.effectiveVolume()).toBe(12);
    player.setDucked(false);
    expect(player.effectiveVolume()).toBe(80);
  });

  it('a change made during the duck is what the release brings back', () => {
    player.setVolume(80);
    player.setDucked(true);
    player.setVolume(40);
    expect(player.effectiveVolume()).toBe(6);
    player.setDucked(false);
    expect(player.effectiveVolume()).toBe(40);
  });

  it('a repeated state is not a change (the host says it again at every turn)', () => {
    player.setDucked(true);
    const before = player.getPlayer();
    player.setDucked(true);
    expect(player.getPlayer()).toBe(before);
  });

  it('never rounds a quiet volume up, and zero stays zero', () => {
    player.setVolume(0);
    player.setDucked(true);
    expect(player.effectiveVolume()).toBe(0);
    player.setVolume(3);
    expect(player.effectiveVolume()).toBe(0);
  });
});

describe('in a window that does not play (the exploded view)', () => {
  it('every control sends its command and changes nothing here; the window that plays applies it', () => {
    const sent: player.PlayerCommand[] = [];
    player.__resetPlayerForTests({ queue: [A, B], index: 0, playing: true });
    player.setForward((c) => sent.push(c));
    player.pause();
    player.next();
    player.setVolume(30);
    player.setMuted(true);
    player.playQueue([B], 0, { kind: 'single' });
    expect(sent.map((c) => c.op)).toEqual(['pause', 'next', 'setVolume', 'setMuted', 'playQueue']);
    expect(player.getPlayer()).toMatchObject({ index: 0, playing: true, volume: 80, muted: false });
    player.setForward(null);
    player.pause();
    expect(player.getPlayer().playing).toBe(false);
  });

  it('the state it is told keeps its own orb duck', () => {
    player.__resetPlayerForTests();
    player.setDucked(true);
    player.applyPeer({ queue: [A], index: 0, playing: true, volume: 50, muted: false, from: null, error: null, position: 3, duration: 9 }, 3);
    expect(player.getPlayer()).toMatchObject({ ducked: true, resumeAt: 3, volume: 50 });
    expect(player.effectiveVolume()).toBe(8);
  });
});
