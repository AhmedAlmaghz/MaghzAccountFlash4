import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';
import { useAppStore } from '@/core/store';

vi.mock('./useUpdateCheck', () => ({
  useUpdateCheck: vi.fn(),
}));

import { useUpdateCheck } from './useUpdateCheck';

const mockedCheck = vi.mocked(useUpdateCheck);

const webInfo = {
  hasUpdate: true,
  info: {
    latest: '0.25.11',
    current: '0.25.10',
    url: 'https://github.com/AhmedAlmaghz/MaghzAccountFlash4/releases',
    channel: 'stable' as const,
    isBeta: false,
  },
  checking: false,
  error: null,
  channel: 'stable' as const,
  dismiss: vi.fn(),
  checkNow: vi.fn(),
  setChannel: vi.fn(),
};

type Sub = (cb: (arg?: never) => void) => () => void;

function desktopBridge() {
  const subs: Record<string, Array<(arg?: never) => void>> = {};
  const sub = (key: string): Sub => (cb) => {
    (subs[key] ??= []).push(cb as (arg?: never) => void);
    return () => {};
  };
  const bridge = {
    quitAndInstall: vi.fn(),
    downloadUpdate: vi.fn(async () => ({ success: true })),
    getUpdateCaps: vi.fn(async () => ({ canAutoUpdate: true })),
    openExternal: vi.fn(),
    onUpdateDownloaded: sub('downloaded'),
    onUpdateAvailable: sub('available'),
    onProgress: sub('progress'),
    onError: sub('error'),
  };
  return { bridge, subs };
}

describe('UpdateBanner — silent desktop updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: 'ar' });
    mockedCheck.mockReturnValue({ ...webInfo, dismiss: vi.fn() });
    delete (window as unknown as { electronEnv?: unknown }).electronEnv;
    delete (window as unknown as { electronUpdater?: unknown }).electronUpdater;
  });

  afterEach(() => {
    delete (window as unknown as { electronEnv?: unknown }).electronEnv;
    delete (window as unknown as { electronUpdater?: unknown }).electronUpdater;
  });

  it('web: shows the badge with an update button', () => {
    render(<UpdateBanner />);
    expect(screen.getByText(/يتوفر تحديث جديد/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /تحديث الآن/ })).toBeTruthy();
  });

  it('web: renders nothing without an update', () => {
    mockedCheck.mockReturnValue({ ...webInfo, hasUpdate: false, info: null });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('desktop downloaded: restart button calls quitAndInstall', async () => {
    (window as unknown as { electronEnv?: unknown }).electronEnv = { isElectron: true };
    const { bridge, subs } = desktopBridge();
    (window as unknown as { electronUpdater?: unknown }).electronUpdater = bridge;
    render(<UpdateBanner />);
    await act(async () => {
      for (const cb of subs.downloaded) cb();
    });
    const btn = screen.getByRole('button', { name: /إعادة التشغيل الآن/ });
    fireEvent.click(btn);
    expect(bridge.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('desktop available: button starts a silent background download, progress shows, then restart', async () => {
    (window as unknown as { electronEnv?: unknown }).electronEnv = { isElectron: true };
    const { bridge, subs } = desktopBridge();
    (window as unknown as { electronUpdater?: unknown }).electronUpdater = bridge;
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: /تحديث الآن/ }));
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    await act(async () => {
      for (const cb of subs.progress) (cb as (p: unknown) => void)({ percent: 42 });
    });
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText(/42%/)).toBeTruthy();
    await act(async () => {
      for (const cb of subs.downloaded) cb();
    });
    expect(screen.getByRole('button', { name: /إعادة التشغيل الآن/ })).toBeTruthy();
  });

  it('desktop portable: falls back to the releases page instead of a doomed download', async () => {
    (window as unknown as { electronEnv?: unknown }).electronEnv = { isElectron: true };
    const { bridge } = desktopBridge();
    bridge.getUpdateCaps = vi.fn(async () => ({ canAutoUpdate: false }));
    (window as unknown as { electronUpdater?: unknown }).electronUpdater = bridge;
    render(<UpdateBanner />);
    // caps resolve async — flush before clicking
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /تحديث الآن/ }));
    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    expect(bridge.openExternal).toHaveBeenCalledOnce();
  });

  it('desktop: badge appears from the updater event even without web poll data', async () => {
    mockedCheck.mockReturnValue({ ...webInfo, hasUpdate: false, info: null });
    (window as unknown as { electronEnv?: unknown }).electronEnv = { isElectron: true };
    const { subs } = desktopBridge();
    const second = desktopBridge();
    void subs;
    (window as unknown as { electronUpdater?: unknown }).electronUpdater = second.bridge;
    render(<UpdateBanner />);
    await act(async () => {
      for (const cb of second.subs.available) (cb as (info: unknown) => void)({ version: '0.25.12' });
    });
    expect(screen.getByText(/0\.25\.12/)).toBeTruthy();
  });
});
