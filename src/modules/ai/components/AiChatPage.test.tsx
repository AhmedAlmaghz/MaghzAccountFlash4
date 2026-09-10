import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AiChatPage from './AiChatPage';
import { aiApi } from '../api';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';

// Heavy children are replaced — this gate checks page-level wiring
// (permission gate, config check, purge sweep), not the chat engine itself.
vi.mock('../api', () => ({
  aiApi: {
    getConfig: vi.fn(),
    purgeOldSessions: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('./ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel-mock" />,
}));
vi.mock('./SessionsDrawer', () => ({
  SessionsDrawer: () => <div data-testid="sessions-drawer-mock" />,
}));
vi.mock('../engine/chatEngine', () => ({
  getChatEngine: () => ({ reset: vi.fn(), restoreHistorySync: vi.fn() }),
}));
vi.mock('../api/persistence', () => ({
  aiPersistence: {
    saveCurrentSession: vi.fn(async () => true),
    loadSession: vi.fn(async () => null),
    renameSession: vi.fn(async () => ({ success: true })),
    deleteSession: vi.fn(async () => ({ success: true })),
    listSessions: vi.fn(async () => []),
  },
}));

const mockedGetConfig = vi.mocked(aiApi.getConfig);
const mockedPurge = vi.mocked(aiApi.purgeOldSessions);

describe('AiChatPage (Stage-3 component gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: 'ar', activeCompany: { id: 'c1' } as never });
    useAuthStore.getState().logout();
    mockedGetConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, hasApiKey: true },
    } as never);
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <AiChatPage />
      </MemoryRouter>,
    );
  }

  it('renders the chat panel for users with ai.use', async () => {
    useAuthStore.getState().login({
      id: '1', username: 'admin', email: 'a@b.com', role: 'super_admin', isActive: true,
    } as never);
    renderPage();
    expect(await screen.findByTestId('chat-panel-mock')).toBeInTheDocument();
  });

  it('shows the no-permission state for users without ai.use', async () => {
    useAuthStore.getState().login({
      id: '9', username: 'nobody', email: 'n@n.com', role: 'no_ai_role_xyz', isActive: true,
      permissions: [],
    } as never);
    renderPage();
    expect(await screen.findByText(/لا تملك|صلاحية|غير مصرح|AI/i)).toBeInTheDocument();
  });

  it('fires the PII retention sweep on open (fire-and-forget)', async () => {
    useAuthStore.getState().login({
      id: '1', username: 'admin', email: 'a@b.com', role: 'super_admin', isActive: true,
    } as never);
    renderPage();
    expect(await screen.findByTestId('chat-panel-mock')).toBeInTheDocument();
    expect(mockedPurge).toHaveBeenCalledWith('c1', '1');
  });
});
