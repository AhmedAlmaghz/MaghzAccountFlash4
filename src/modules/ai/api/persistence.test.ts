import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveSession: vi.fn(),
}));

vi.mock('./index', () => ({
  aiApi: { saveSession: mocks.saveSession },
}));

import { aiPersistence } from './persistence';
import { useAiStore } from '../store';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const user: User = { id: 'u1', username: 'tester', role: 'manager', isActive: true };

describe('aiPersistence.saveCurrentSession — session separation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAiStore.getState().clearMessages();
    useAppStore.setState({
      activeCompany: { id: '11111111-1111-1111-1111-111111111111', name: 'شركة الاختبار', currency: 'YER' },
    });
  });

  it('stamps the new session id on a normal first save', async () => {
    useAiStore.getState().addMessage({ role: 'user', kind: 'text', content: 'أول رسالة' });
    mocks.saveSession.mockResolvedValueOnce({ success: true, data: { sessionId: 'NEW-SID' } });

    await aiPersistence.saveCurrentSession();

    expect(mocks.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null })
    );
    expect(useAiStore.getState().sessionId).toBe('NEW-SID');
  });

  it('does NOT stamp a stale session id when the user switched conversations mid-save', async () => {
    // Old conversation, never saved (sessionId null):
    useAiStore.getState().addMessage({ role: 'user', kind: 'text', content: 'سؤال قديم' });

    let resolveSave!: (v: { success: true; data: { sessionId: string } }) => void;
    mocks.saveSession.mockImplementationOnce(
      () => new Promise((res) => { resolveSave = res; })
    );
    const pending = aiPersistence.saveCurrentSession();

    // User opens a new chat / selects another session BEFORE the save lands:
    useAiStore.getState().clearMessages();
    useAiStore.getState().setSessionId('22222222-2222-2222-2222-222222222222');
    useAiStore.getState().addMessage({ role: 'user', kind: 'text', content: 'سؤال جديد' });

    // The stale save finally completes with the OLD conversation's new id:
    resolveSave({ success: true, data: { sessionId: 'OLD-SID' } });
    await pending;

    // Without the guard, the store would now carry OLD-SID and the next save
    // would DELETE the old session's messages and overwrite its row.
    expect(useAiStore.getState().sessionId).toBe('22222222-2222-2222-2222-222222222222');
    expect(useAiStore.getState().messages.map((m) => m.content)).toEqual(['سؤال جديد']);
  });
});
