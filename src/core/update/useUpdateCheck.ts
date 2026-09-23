import { useState, useEffect, useCallback, useRef } from 'react';
import { APP_VERSION } from '@/core/brand';

const GITHUB_OWNER = 'AhmedAlmaghz';
const GITHUB_REPO = 'MaghzAccountFlash4';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours — best
const DISMISS_KEY = 'maghz-update-dismissedUntil';
const CHANNEL_KEY = 'maghz-update-channel';

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateInfo {
  latest: string; // e.g. "0.25.4" without v
  current: string;
  url: string; // GitHub release page
  channel: UpdateChannel;
  isBeta: boolean;
}

function getChannel(): UpdateChannel {
  try {
    const v = localStorage.getItem(CHANNEL_KEY);
    if (v === 'beta') return 'beta';
  } catch { /* ignore */ }
  return 'stable';
}

export function setUpdateChannel(c: UpdateChannel): void {
  try { localStorage.setItem(CHANNEL_KEY, c); } catch { /* ignore */ }
}

export function getUpdateChannel(): UpdateChannel {
  return getChannel();
}

function isDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() < Number(v);
  } catch { return false; }
}

export function dismissUpdate(durationMs = 24 * 60 * 60 * 1000): void {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now() + durationMs)); } catch { /* ignore */ }
}

function parseTag(tag: string): string {
  return tag.replace(/^v/, '').trim();
}

function isBetaTag(tag: string): boolean {
  return /-beta|alpha|rc/i.test(tag);
}

/** Naïve semver compare — sufficient for our versioning. */
function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => Number(x.replace(/[^0-9]/g, '')) || 0);
  const pb = b.split('.').map((x) => Number(x.replace(/[^0-9]/g, '')) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false; // equal
}

async function fetchLatestFromGitHub(channel: UpdateChannel): Promise<{ tag: string; url: string } | null> {
  const res = await fetch(GITHUB_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json() as Array<{ tag_name: string; html_url: string; prerelease: boolean; draft: boolean }>;
  if (!Array.isArray(data)) return null;
  // Filter out drafts, then pick by channel
  const filtered = data.filter((r) => !r.draft);
  if (filtered.length === 0) return null;
  if (channel === 'stable') {
    const stable = filtered.find((r) => !r.prerelease && !isBetaTag(r.tag_name));
    if (stable) return { tag: parseTag(stable.tag_name), url: stable.html_url };
    return null;
  }
  // beta: prefer latest prerelease/beta, else stable
  const beta = filtered.find((r) => r.prerelease || isBetaTag(r.tag_name));
  if (beta) return { tag: parseTag(beta.tag_name), url: beta.html_url };
  const stable = filtered.find((r) => !r.prerelease);
  if (stable) return { tag: parseTag(stable.tag_name), url: stable.html_url };
  return { tag: parseTag(filtered[0].tag_name), url: filtered[0].html_url };
}

async function fetchVersionJson(): Promise<{ version: string } | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    if (typeof data.version === 'string' && data.version) return { version: parseTag(data.version) };
  } catch { /* ignore — offline or not yet deployed */ }
  return null;
}

export interface UseUpdateCheckReturn {
  hasUpdate: boolean;
  info: UpdateInfo | null;
  checking: boolean;
  error: string | null;
  channel: UpdateChannel;
  dismiss: () => void;
  checkNow: () => Promise<void>;
  setChannel: (c: UpdateChannel) => void;
}

export function useUpdateCheck(): UseUpdateCheckReturn {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannelState] = useState<UpdateChannel>(() => getChannel());
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    if (isDismissed()) return;
    // Don't check in e2e
    try {
      if ((import.meta as unknown as { env?: { VITE_E2E?: string } }).env?.VITE_E2E === '1') return;
    } catch { /* ignore */ }
    setChecking(true);
    setError(null);
    const ch = getChannel();
    try {
      // Try GitHub first, fallback to version.json
      let latest: { tag: string; url: string } | null = null;
      let source: 'github' | 'version.json' = 'github';
      try {
        latest = await fetchLatestFromGitHub(ch);
      } catch (e) {
        // GitHub failed (rate limit / offline) — fallback
        source = 'version.json';
        latest = null;
      }
      if (!latest) {
        const v = await fetchVersionJson();
        if (v) {
          latest = { tag: v.version, url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases` };
          source = 'version.json';
        }
      }
      if (!latest) {
        if (mountedRef.current) setChecking(false);
        return;
      }
      const current = APP_VERSION;
      if (current === '0.0.0-dev') {
        // Dev build — don't notify, but allow manual check to see latest
        if (mountedRef.current) setChecking(false);
        return;
      }
      if (semverGt(latest.tag, current)) {
        const next: UpdateInfo = {
          latest: latest.tag,
          current,
          url: latest.url,
          channel: ch,
          isBeta: isBetaTag(latest.tag),
        };
        if (mountedRef.current) setInfo(next);
      } else {
        if (mountedRef.current) setInfo(null);
      }
      // keep source for debugging if needed
      void source;
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  const setChannel = useCallback((c: UpdateChannel) => {
    setUpdateChannel(c);
    setChannelState(c);
    // Notify desktop main process so autoUpdater.allowPrerelease follows the choice
    try {
      const eu = (window as unknown as { electronUpdater?: { setChannel?: (ch: string) => void } }).electronUpdater;
      eu?.setChannel?.(c);
      // Also persist for next main restart (main reads update-channel.json)
      if (typeof window !== 'undefined' && (window as unknown as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron) {
        try { window.dispatchEvent(new CustomEvent('app:updateChannelChanged', { detail: c })); } catch { /* ignore */ }
        // Fire-and-forget IPC (preload's setChannel already does file write)
      }
    } catch { /* ignore */ }
    // Clear dismiss when switching channel so banner can reappear
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
    // Re-check immediately on channel change
    void check();
  }, [check]);

  const dismiss = useCallback(() => {
    dismissUpdate();
    setInfo(null);
  }, []);

  const checkNow = useCallback(async () => {
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
    await check();
  }, [check]);

  useEffect(() => {
    mountedRef.current = true;
    void check();
    const id = window.setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [check]);

  const hasUpdate = !!info && !isDismissed();

  return { hasUpdate, info, checking, error, channel, dismiss, checkNow, setChannel };
}
