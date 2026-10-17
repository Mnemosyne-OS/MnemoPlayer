/**
 * YoutubeAgentActions — serves MnemoPlayer's agent actions (doc 149) while the
 * window is open. A CHILD that renders nothing, never a hook in App. The
 * handlers live in lib/agent.ts and read the shared stores at each call, so
 * they always see what the screen shows; this only subscribes ONCE.
 */
import { useEffect } from 'react';
import { youtubeAgentHandlers } from '../lib/agent';
import { hasHost, sdk } from '../lib/host';

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : String(Date.now()));

export function YoutubeAgentActions() {
  useEffect(() => {
    // Outside the shell nobody calls (a plain tab, the tests).
    if (!hasHost()) return undefined;
    if (typeof sdk.onAgentActions !== 'function') {
      // An iframe served an older SDK build: it must not take the window down.
      console.warn('[youtube] this SDK build has no onAgentActions; reload the cartridge to serve agent actions');
      return undefined;
    }
    const sub = sdk.onAgentActions(youtubeAgentHandlers({ newId, now: () => new Date() }));
    sub.ready.catch((err: unknown) => console.warn('[youtube] agent actions not served:', err instanceof Error ? err.message : err));
    return () => sub.off();
  }, []);

  return null;
}
