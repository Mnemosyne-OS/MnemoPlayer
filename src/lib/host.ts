/**
 * host.ts — the one SDK instance of MnemoPlayer and its calls to the host.
 *
 * Every YouTube call goes through a named host action (doc 151): the
 * cartridge never holds a key, a token or a URL to Google, and never sees the
 * path of a video it uploads.
 */
import { MnemoCartridgeSDK } from '../sdk/mnemo-sdk';

/** Must match "name" in mnemo-plugin.json: the host keys state and permissions on it. */
export const PLUGIN_ID = '@mnemosyne-plugins/mnemo-youtube';
export const HOST_TIMEOUT_MS = 15_000;

export const sdk = new MnemoCartridgeSDK(PLUGIN_ID);

/** True inside the shell. Standalone in a browser (dev) nothing answers. */
export function hasHost(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/** One host action; a refusal is thrown with the host's code as its message. */
export function call<T>(action: string, payload?: Record<string, unknown>, timeoutMs = HOST_TIMEOUT_MS): Promise<T> {
  if (!hasHost()) return Promise.reject(new Error('NO_HOST'));
  return sdk.invoke<T>(action, payload, timeoutMs);
}

/** The code of a refusal: the host's own word (`QUOTA_EXCEEDED`), or a short one for the unknown. */
export function codeOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /^[A-Z][A-Z0-9_]{2,40}/.exec(msg);
  if (m) return m[0];
  if (/did not reply/i.test(msg)) return 'TIMEOUT';
  if (/permission|denied|not granted/i.test(msg)) return 'PERMISSION_DENIED';
  return 'FAILED';
}

/** Opens a page in the person's browser (YouTube Studio, Google Cloud). */
export function openExternal(url: string): void {
  call('shell.openExternal', { url }).catch((err: unknown) => console.warn('[youtube] could not open', url, codeOf(err)));
}
