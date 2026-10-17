/**
 * outputSpectrum.ts — the spectrum of the COMPUTER'S output sound, lent by the
 * host (doc 151 §10.3), so the visualizer also moves with YouTube.
 *
 * The cartridge never captures anything. It asks the host, on a click, to
 * listen to the speakers' mix (Windows loopback, the conversation recorder's
 * door, doc 112) and receives ONLY numbers: BAND_COUNT loudness values about
 * 30 times a second. Never the sound itself, and nothing is recorded.
 *
 *  - off by default, switched on by a click (the host refuses a call that does
 *    not come from a click in this frame: NOT_FROM_A_GESTURE);
 *  - Windows only for now: elsewhere the host answers UNSUPPORTED_OS and the
 *    switch is not drawn;
 *  - it stops when switched off, when this window closes (the host no longer
 *    finds the frame), and when this cartridge stops saying it still wants it
 *    (a keep-alive every KEEP_EVERY_MS; the host gives up after ~30 s of none).
 *
 * ⚠️ It is the WHOLE computer's sound: a notification, a call, another app.
 * The switch says so in one line.
 */
import { useSyncExternalStore } from 'react';
import { BAND_COUNT } from './spectrumBands';
import { call, codeOf, hasHost } from './host';

export const SPECTRUM_MESSAGE = 'MNEMO_OUTPUT_SPECTRUM';
export const KEEP_EVERY_MS = 10_000;
/** Older bins than this are not drawn: the host went quiet, the bars must not freeze on a stale frame. */
export const FRESH_MS = 400;

export type OutputStatus = 'unknown' | 'unsupported' | 'off' | 'starting' | 'on';

export interface OutputSnapshot {
  status: OutputStatus;
  /** The last refusal (NOT_FROM_A_GESTURE, PERMISSION_DENIED, CAPTURE_FAILED…), cleared by a start. */
  error: string | null;
}

let snap: OutputSnapshot = { status: 'unknown', error: null };
const listeners = new Set<() => void>();
const publish = (next: OutputSnapshot) => { snap = next; listeners.forEach((fn) => fn()); };

const latest = new Float32Array(BAND_COUNT);
let receivedAt = 0;
let keepTimer: ReturnType<typeof setInterval> | undefined;
let now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function getOutput(): OutputSnapshot {
  return snap;
}

export function useOutput(): OutputSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getOutput);
}

function stopKeeping(): void {
  if (keepTimer !== undefined) clearInterval(keepTimer);
  keepTimer = undefined;
}

/**
 * Reads one message of the host. Only the parent frame speaks, and only
 * numbers are kept: anything else in the message is ignored.
 */
export function onHostMessage(event: MessageEvent): void {
  if (typeof window === 'undefined' || event.source !== window.parent) return;
  const d = event.data as { type?: unknown; bins?: unknown; stopped?: unknown; reason?: unknown } | null;
  if (!d || d.type !== SPECTRUM_MESSAGE) return;
  if (d.stopped === true) {
    stopKeeping();
    receivedAt = 0;
    publish({ status: 'off', error: typeof d.reason === 'string' && d.reason !== 'STOPPED' ? d.reason : null });
    return;
  }
  if (!Array.isArray(d.bins)) return;
  for (let i = 0; i < BAND_COUNT; i++) {
    const v = d.bins[i];
    latest[i] = typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v / 255)) : 0;
  }
  receivedAt = now();
}

/** Copies the freshest output bands into `out`. False when the host sent nothing recently. */
export function readOutputBands(out: Float32Array): boolean {
  if (snap.status !== 'on' || !receivedAt || now() - receivedAt > FRESH_MS) return false;
  out.set(latest.subarray(0, out.length));
  return true;
}

/** Asks the host once whether this machine can do it. Draws nothing until it knows. */
export async function probeOutput(): Promise<OutputSnapshot> {
  if (!hasHost()) { publish({ status: 'unsupported', error: null }); return snap; }
  try {
    const r = await call<{ supported?: boolean; active?: boolean }>('audio.outputSpectrumStatus');
    if (r?.supported !== true) publish({ status: 'unsupported', error: null });
    else if (snap.status === 'unknown') publish({ status: r.active ? 'on' : 'off', error: null });
  } catch (err) {
    // An older host has no such action: the switch is simply not offered.
    console.warn('[youtube] output spectrum not offered by this host:', codeOf(err));
    publish({ status: 'unsupported', error: null });
  }
  return snap;
}

/** The person clicked the switch on. */
export async function startOutput(): Promise<OutputSnapshot> {
  publish({ status: 'starting', error: null });
  try {
    await call('audio.outputSpectrumStart', undefined, 20_000);
    publish({ status: 'on', error: null });
    stopKeeping();
    keepTimer = setInterval(() => {
      call('audio.outputSpectrumKeep').catch((err: unknown) => {
        stopKeeping();
        publish({ status: 'off', error: codeOf(err) });
      });
    }, KEEP_EVERY_MS);
  } catch (err) {
    const code = codeOf(err);
    publish({ status: code === 'UNSUPPORTED_OS' ? 'unsupported' : 'off', error: code });
  }
  return snap;
}

/** The person clicked the switch off, or the panel went away. */
export async function stopOutput(): Promise<void> {
  stopKeeping();
  receivedAt = 0;
  if (snap.status === 'on' || snap.status === 'starting') publish({ status: 'off', error: null });
  if (!hasHost()) return;
  try {
    await call('audio.outputSpectrumStop');
  } catch (err) {
    // The host stops on its own when the keep-alive stops; said, not thrown.
    console.warn('[youtube] output spectrum stop not confirmed:', codeOf(err));
  }
}

/** Tests only. */
export function __resetOutputForTests(clock?: () => number, status: OutputStatus = 'unknown'): void {
  stopKeeping();
  snap = { status, error: null };
  receivedAt = 0;
  latest.fill(0);
  if (clock) now = clock;
}
