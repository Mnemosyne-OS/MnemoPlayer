/**
 * The exploded view's contract with the host (doc 143, doc 151 §13): the
 * windows the button asks for are the ones the manifest declares, none opens on
 * a plain launch, the dock's declared board is the button's board, and the
 * host's OWN reader accepts it (a board that does not read is left out whole).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBoardRequest, readBoards } from '../../../infinity-edition/src/renderer/src/lib/cartridgeBoard';
import { BOARD_LAYOUT, BOARD_ZOOM, boardWhy, useBoard } from './board';
import { WIDGET_OF } from './sync';
import { sdk } from './host';
import * as player from './player';
import { HANDOVER_KEY } from './sync';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'mnemo-plugin.json'), 'utf8')) as {
  widgets: Array<{ id: string; openOnLaunch?: boolean }>;
  boards: Array<{ id: string; zoom: number; windows: unknown[] }>;
  agentActions: Array<{ id: string }>;
};

beforeEach(() => {
  window.localStorage.clear();
  player.__resetPlayerForTests();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the manifest', () => {
  it('declares every board window, none opens on a plain launch, and the single window stays the first', () => {
    expect(manifest.widgets[0]).toMatchObject({ id: 'mnemo-youtube-main' });
    expect(manifest.widgets[0]!.openOnLaunch).toBeUndefined();
    for (const w of BOARD_LAYOUT) expect(manifest.widgets.find((x) => x.id === w.id)?.openOnLaunch).toBe(false);
    expect(BOARD_LAYOUT.map((w) => w.id).sort()).toEqual(Object.values(WIDGET_OF).sort());
  });

  it('declares the same board the button opens, and the host reads it whole', () => {
    const b = manifest.boards.find((x) => x.id === 'exploded')!;
    expect(b.zoom).toBe(BOARD_ZOOM);
    expect(b.windows).toEqual(BOARD_LAYOUT);
    const read = readBoards(manifest);
    expect(read.map((x) => x.id)).toEqual(['exploded']);
    expect(read[0]!.windows).toHaveLength(BOARD_LAYOUT.length);
    const req = parseBoardRequest({ windows: BOARD_LAYOUT, fill: true, zoom: BOARD_ZOOM }, manifest.widgets);
    expect(req.ok).toBe(true);
  });

  it('the layout covers the view without two windows on the same spot', () => {
    expect(BOARD_LAYOUT.reduce((a, w) => a + w.w * w.h, 0)).toBeCloseTo(1, 6);
    for (const w of BOARD_LAYOUT) {
      expect(w.x + w.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(w.y + w.h).toBeLessThanOrEqual(1 + 1e-9);
      for (const o of BOARD_LAYOUT) {
        if (o === w) continue;
        const overlap = Math.max(0, Math.min(w.x + w.w, o.x + o.w) - Math.max(w.x, o.x)) * Math.max(0, Math.min(w.y + w.h, o.y + o.h) - Math.max(w.y, o.y));
        expect(overlap).toBeLessThan(1e-9);
      }
    }
  });

  it('no voice action opens or leaves the board: the host refuses both without a click in the frame', () => {
    const ids = manifest.agentActions.map((a) => a.id);
    for (const banned of ['explode', 'showBoard', 'openBoard', 'leaveBoard']) expect(ids).not.toContain(banned);
  });
});

describe('the button', () => {
  it('outside the shell there is no board: the press asks nothing', () => {
    const invoke = vi.spyOn(sdk, 'invoke');
    const { result } = renderHook(() => useBoard());
    expect(result.current.available).toBe(false);
    act(() => result.current.open());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks for the five windows and leaves what plays for the Player window first', async () => {
    vi.stubGlobal('parent', { postMessage() {} });
    const invoke = vi.spyOn(sdk, 'invoke').mockResolvedValue({ opened: true });
    player.playQueue([{ kind: 'yt', videoId: 'aaaaaaaaaaa', title: 'A' }], 0, { kind: 'single' });
    const { result } = renderHook(() => useBoard());
    act(() => result.current.open());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(invoke).toHaveBeenCalledWith('canvas.openBoard', { windows: BOARD_LAYOUT, fill: true, zoom: BOARD_ZOOM }, expect.any(Number));
    expect(JSON.parse(window.localStorage.getItem(HANDOVER_KEY)!).s.queue[0].videoId).toBe('aaaaaaaaaaa');
    expect(result.current.error).toBeNull();
  });

  it('a full pager offers « Open here », the same windows on this desktop; a refusal is said in words', async () => {
    vi.stubGlobal('parent', { postMessage() {} });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invoke = vi.spyOn(sdk, 'invoke').mockRejectedValueOnce(new Error('BOARD_FULL')).mockResolvedValueOnce({ opened: true });
    const { result } = renderHook(() => useBoard());
    act(() => result.current.open());
    await waitFor(() => expect(result.current.full).toBe(true));
    expect(result.current.error).toMatch(/9 desktops/);
    act(() => result.current.openHere());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(invoke).toHaveBeenLastCalledWith('canvas.openBoard', { windows: BOARD_LAYOUT, fill: true, zoom: BOARD_ZOOM, here: true, replace: true }, expect.any(Number));
    expect(boardWhy('NOT_FROM_A_GESTURE', 'NOT_FROM_A_GESTURE')).toMatch(/Press the button/);
    expect(boardWhy('FAILED', 'weird thing')).toMatch(/weird thing/);
  });
});
