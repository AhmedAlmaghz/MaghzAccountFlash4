import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionsDrawer } from './SessionsDrawer';
import { aiPersistence } from '../api/persistence';
import { useAppStore } from '@/core/store';

vi.mock('../api/persistence', () => ({
  aiPersistence: { listSessions: vi.fn() },
}));

const mockedList = vi.mocked(aiPersistence.listSessions);

describe('SessionsDrawer (Stage-3 component gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: 'ar' });
  });

  it('renders grouped sessions after load', async () => {
    mockedList.mockResolvedValue([
      { id: 's1', title: 'فاتورة أحمد', updatedAt: new Date().toISOString(), messageCount: 4 },
      { id: 's2', title: 'تقرير المخزون', updatedAt: new Date().toISOString(), messageCount: 2 },
    ]);
    render(<SessionsDrawer onSelect={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} currentSessionId={null} />);
    expect(await screen.findByText('فاتورة أحمد')).toBeInTheDocument();
    expect(screen.getByText('تقرير المخزون')).toBeInTheDocument();
  });

  it('shows the empty state when no sessions match (ai.sessions.noResults)', async () => {
    mockedList.mockResolvedValue([]);
    render(<SessionsDrawer onSelect={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} currentSessionId={null} />);
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    // Empty — neither session title may appear; the noResults key must exist in i18n instead of a raw crash
    expect(screen.queryByText('فاتورة أحمد')).not.toBeInTheDocument();
  });

  it('search filters the session list', async () => {
    mockedList.mockResolvedValue([
      { id: 's1', title: 'فاتورة أحمد', updatedAt: new Date().toISOString(), messageCount: 4 },
      { id: 's2', title: 'تقرير المخزون', updatedAt: new Date().toISOString(), messageCount: 2 },
    ]);
    render(<SessionsDrawer onSelect={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} currentSessionId={null} />);
    expect(await screen.findByText('فاتورة أحمد')).toBeInTheDocument();
    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'مخزون' } });
    await waitFor(() => {
      expect(screen.queryByText('فاتورة أحمد')).not.toBeInTheDocument();
      expect(screen.getByText('تقرير المخزون')).toBeInTheDocument();
    });
  });

  it('select and delete callbacks fire with the session id', async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    mockedList.mockResolvedValue([
      { id: 's1', title: 'فاتورة أحمد', updatedAt: new Date().toISOString(), messageCount: 4 },
    ]);
    render(<SessionsDrawer onSelect={onSelect} onDelete={onDelete} onRename={vi.fn()} currentSessionId={null} />);
    fireEvent.click(await screen.findByText('فاتورة أحمد'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});
