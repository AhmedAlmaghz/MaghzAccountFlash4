import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BatchProgressCard } from './BatchProgressCard';
import { getBatch, listBatches, pauseBatch, cancelBatch, retryFailedBatch, unpauseBatch } from '../api/batch';
import { useAppStore } from '@/core/store';
import type { JobBatchDetail } from '../api/batchTypes';

vi.mock('../api/batch', () => ({
  getBatch: vi.fn(),
  listBatches: vi.fn(),
  pauseBatch: vi.fn(),
  unpauseBatch: vi.fn(),
  cancelBatch: vi.fn(),
  retryFailedBatch: vi.fn(),
}));

const mockedGet = vi.mocked(getBatch);
const mockedList = vi.mocked(listBatches);

function detail(over: Partial<JobBatchDetail> = {}): JobBatchDetail {
  return {
    id: 'b1',
    kind: 'mixed',
    title: 'دفعة الفواتير',
    totalCount: 10,
    doneCount: 6,
    failedCount: 1,
    skippedCount: 0,
    status: 'running',
    createdAt: '',
    updatedAt: '',
    items: [
      {
        id: 'i1', seq: 2, toolName: 'sales.create_invoice', args: {},
        afterSeq: null, label: null, status: 'failed', attempts: 4,
        lastError: 'عميل مفقود', errorCode: 'NOT_FOUND', resultRef: null,
      },
    ],
    ...over,
  };
}

/** Header-only summary (what listBatches returns — counts, no items). */
function header(over: Partial<Record<string, unknown>> = {}) {
  const { items: _items, ...rest } = detail();
  return { ...rest, ...over };
}

describe('BatchProgressCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: 'ar' });
    mockedGet.mockResolvedValue({ success: true, data: detail() });
    // Header poll default: batch visible, still running — merges without reload.
    mockedList.mockResolvedValue({ success: true, data: [{ ...header(), status: 'running' }] });
  });

  it('renders title, status, counts and progress', async () => {
    render(<BatchProgressCard batchId="b1" />);
    expect(await screen.findByText('دفعة الفواتير')).toBeTruthy();
    expect(await screen.findByText('قيد التنفيذ')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText(/6/)).toBeTruthy();
  });

  it('lists top failed errors', async () => {
    render(<BatchProgressCard batchId="b1" />);
    expect(await screen.findByText(/عميل مفقود/)).toBeTruthy();
  });

  it('pauses and reloads on pause click', async () => {
    vi.mocked(pauseBatch).mockResolvedValue({ success: true });
    render(<BatchProgressCard batchId="b1" />);
    const btn = await screen.findByRole('button', { name: /إيقاف مؤقت/ });
    fireEvent.click(btn);
    await waitFor(() => expect(pauseBatch).toHaveBeenCalledWith('b1'));
  });

  it('offers resume when paused', async () => {
    mockedGet.mockResolvedValue({ success: true, data: detail({ status: 'paused' }) });
    vi.mocked(unpauseBatch).mockResolvedValue({ success: true });
    render(<BatchProgressCard batchId="b1" />);
    const btn = await screen.findByRole('button', { name: /استئناف/ });
    fireEvent.click(btn);
    await waitFor(() => expect(unpauseBatch).toHaveBeenCalledWith('b1'));
  });

  it('offers retry-failed when failures exist', async () => {
    vi.mocked(retryFailedBatch).mockResolvedValue({ success: true, data: { requeued: 1 } });
    render(<BatchProgressCard batchId="b1" />);
    const btn = await screen.findByRole('button', { name: /إعادة الفاشلة/ });
    fireEvent.click(btn);
    await waitFor(() => expect(retryFailedBatch).toHaveBeenCalledWith('b1'));
  });

  it('cancels on cancel click', async () => {
    vi.mocked(cancelBatch).mockResolvedValue({ success: true });
    render(<BatchProgressCard batchId="b1" />);
    const btn = await screen.findByRole('button', { name: /إلغاء الدفعة/ });
    fireEvent.click(btn);
    await waitFor(() => expect(cancelBatch).toHaveBeenCalledWith('b1'));
  });

  it('renders terminal state without action buttons', async () => {
    mockedGet.mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 10, failedCount: 0 }) });
    render(<BatchProgressCard batchId="b1" />);
    expect(await screen.findByText('مكتملة')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /إيقاف مؤقت/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /إلغاء الدفعة/ })).toBeNull();
  });

  it('shows a load error when the bridge fails', async () => {
    mockedGet.mockResolvedValue({ success: false, error: 'down' });
    render(<BatchProgressCard batchId="b1" />);
    expect(await screen.findByText(/تعذّر قراءة حالة الدفعة/)).toBeTruthy();
  });

  it('polls header-only and merges counts without full re-reads', async () => {
    vi.useFakeTimers();
    try {
      mockedList.mockResolvedValue({
        success: true,
        data: [{ ...header(), status: 'running', doneCount: 9 }],
      });
      render(<BatchProgressCard batchId="b1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('دفعة الفواتير')).toBeTruthy();
      expect(mockedGet).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      // Header merged into the live card…
      expect(mockedList).toHaveBeenCalled();
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
      // …without a second full items re-read.
      expect(mockedGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads full detail once on terminal flip', async () => {
    vi.useFakeTimers();
    try {
      mockedList.mockResolvedValue({
        success: true,
        data: [{ ...header(), status: 'done', doneCount: 10, failedCount: 0 }],
      });
      render(<BatchProgressCard batchId="b1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('دفعة الفواتير')).toBeTruthy();
      // The final paint must reflect terminal items, not the stale mount copy.
      mockedGet.mockResolvedValue({
        success: true,
        data: detail({ status: 'done', doneCount: 10, failedCount: 0 }),
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(screen.getByText('مكتملة')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
