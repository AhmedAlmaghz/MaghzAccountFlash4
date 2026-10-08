import { useEffect, useState } from 'react';

/**
 * Shared relay availability probe (web only).
 *
 * Both database entry points — the onboarding wizard and the settings page
 * — need the same answer: "is there a same-origin relay that can serve
 * non-Neon remotes on web?" One hook, one cached probe (`isRelayAvailable`
 * caches 60s internally), three states. `null` means "still probing" and
 * callers MUST treat it as blocked (fail-closed until known).
 *
 * NOTE: on desktop this always resolves false — direct TCP needs no relay,
 * so desktop callers must never use this value to block anything.
 */
export type RelayStatus = boolean | null;

export function useRelayStatus(enabled = true): RelayStatus {
  const [status, setStatus] = useState<RelayStatus>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { isElectron } = await import('@/core/database/adapters');
        if (isElectron()) {
          if (!cancelled) setStatus(false);
          return;
        }
        const { isRelayAvailable } = await import('@/core/database/relayClient');
        const health = await isRelayAvailable();
        if (!cancelled) setStatus(health.up);
      } catch {
        if (!cancelled) setStatus(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return status;
}
