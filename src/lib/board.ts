/**
 * board.ts — « Exploded view » and « Single view » (doc 151 §13, doc 143).
 *
 * The press asks the host to lay MnemoPlayer's five windows out on the
 * desktop named after it (`canvas.openBoard`, found or created empty, the
 * camera framing them); « Single view » asks for the way back
 * (`canvas.leaveBoard`). What plays travels by itself (sync.ts): the window
 * that played writes a hand-over snapshot at the press, the Player window
 * takes over from it.
 *
 * ⛔ No voice action opens or leaves the board: the host refuses both unless
 * the request follows a click in the window (`NOT_FROM_A_GESTURE`, doc 143
 * §3). The dock's right-click on MnemoPlayer offers the same board (declared
 * in mnemo-plugin.json › boards), as the person's own gesture in the shell.
 */
import { useCallback, useState } from 'react';
import { translate } from '../i18n/useI18n';
import { call, codeOf, hasHost } from './host';
import { saveHandover } from './sync';

/**
 * Where the five windows go, in SHARES of the view: the player top left and
 * the sound under it, the queue down the middle, search and channel on the
 * right. The host sizes them to fill the screen at BOARD_ZOOM.
 */
export const BOARD_LAYOUT = [
  { id: 'mnemo-youtube-player', x: 0, y: 0, w: 0.42, h: 0.6 },
  { id: 'mnemo-youtube-sound', x: 0, y: 0.6, w: 0.42, h: 0.4 },
  { id: 'mnemo-youtube-queue', x: 0.42, y: 0, w: 0.29, h: 1 },
  { id: 'mnemo-youtube-search', x: 0.71, y: 0, w: 0.29, h: 0.5 },
  { id: 'mnemo-youtube-channel', x: 0.71, y: 0.5, w: 0.29, h: 0.5 },
] as const;
export const BOARD_ZOOM = 0.8;

/** The host's refusal, in the person's words; an unknown code keeps its raw text, never a guess. */
export function boardWhy(code: string, raw: string): string {
  const known: Record<string, string> = {
    BOARD_AMBIGUOUS: 'board.why.ambiguous',
    BOARD_FULL: 'board.why.full',
    BOARD_NOWHERE: 'board.why.nowhere',
    BOARD_UNHEARD: 'board.why.unheard',
    TOO_SOON: 'board.why.soon',
    NOT_FROM_A_GESTURE: 'board.why.gesture',
  };
  return known[code] ? translate(known[code]) : translate('board.why.other', { why: raw });
}

export interface BoardState {
  /** False outside the shell (no board to open). */
  available: boolean;
  busy: boolean;
  error: string | null;
  /** The pager is full: « Open here » is offered. */
  full: boolean;
  open: () => void;
  openHere: () => void;
  leave: () => void;
}

export function useBoard(): BoardState {
  const available = hasHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const run = useCallback((action: 'canvas.openBoard' | 'canvas.leaveBoard', payload?: Record<string, unknown>) => {
    if (!available || busy) return;
    // what plays is written NOW, for the window that will play next
    saveHandover('board');
    setBusy(true);
    setError(null);
    setFull(false);
    call(action, payload)
      .then(() => undefined, (err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        const code = codeOf(err);
        if (code === 'BOARD_FULL') setFull(true);
        console.warn('[youtube]', action, 'refused:', raw);
        setError(boardWhy(code, raw));
      })
      .finally(() => setBusy(false));
  }, [available, busy]);

  const open = useCallback(() => run('canvas.openBoard', { windows: BOARD_LAYOUT, fill: true, zoom: BOARD_ZOOM }), [run]);
  // here: the single window closes while the board is open (« Single view » brings it back)
  const openHere = useCallback(() => run('canvas.openBoard', { windows: BOARD_LAYOUT, fill: true, zoom: BOARD_ZOOM, here: true, replace: true }), [run]);
  const leave = useCallback(() => run('canvas.leaveBoard'), [run]);
  return { available, busy, error, full, open, openHere, leave };
}
