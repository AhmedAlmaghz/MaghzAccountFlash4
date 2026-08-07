import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { aiApi } from './index';
import { useAiStore } from '../store';
import type { AiChatSessionSummary, ChatMessage, ToolCallStatus } from '../types';

/**
 * Chat persistence helpers — renderer-side wrappers around the ai:* IPC
 * persistence channels. Keeps the zustand store in sync with the DB.
 *
 * Stale tool-call states are normalized on load: a persisted
 * 'pending-confirmation' or 'executing' call can never be resumed after
 * reload (the engine's LLM history is gone), so it is demoted to a terminal
 * state instead of showing a dead confirmation card.
 */

const STALE_STATUS_MAP: Partial<Record<ToolCallStatus, ToolCallStatus>> = {
  'pending-confirmation': 'rejected',
  executing: 'error',
};

function normalizeLoadedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!m.toolCall) return m;
    const staleTo = STALE_STATUS_MAP[m.toolCall.status];
    if (!staleTo) return m;
    return {
      ...m,
      toolCall: {
        ...m.toolCall,
        status: staleTo,
        resultSummary:
          staleTo === 'rejected'
            ? 'انتهت الجلسة قبل تأكيد العملية — لم تُنفّذ'
            : 'انقطع التنفيذ عند إغلاق الجلسة السابقة',
      },
    };
  });
}

function deriveTitle(messages: ChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return null;
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function currentContext(): { companyId: string; userId: string } | null {
  const companyId = useAppStore.getState().activeCompany?.id;
  const userId = useAuthStore.getState().user?.id;
  if (!companyId || !userId) return null;
  return { companyId, userId };
}

export const aiPersistence = {
  /** Persist the current conversation (create or replace). Fire-and-forget safe. */
  async saveCurrentSession(): Promise<void> {
    const ctx = currentContext();
    if (!ctx) return;
    const { messages, sessionId, setSessionId } = useAiStore.getState();
    if (messages.length === 0) return;

    const res = await aiApi.saveSession({
      companyId: ctx.companyId,
      userId: ctx.userId,
      sessionId,
      title: deriveTitle(messages),
      messages,
    });
    if (res.success && res.data?.sessionId) {
      setSessionId(res.data.sessionId);
    }
  },

  async listSessions(): Promise<AiChatSessionSummary[]> {
    const ctx = currentContext();
    if (!ctx) return [];
    const res = await aiApi.listSessions(ctx.companyId, ctx.userId);
    return res.success && res.data ? res.data : [];
  },

  /** Load a saved session into the store. The engine is reset by the caller. */
  async loadSession(sessionId: string): Promise<boolean> {
    const ctx = currentContext();
    if (!ctx) return false;
    const res = await aiApi.getSessionMessages(ctx.companyId, sessionId);
    if (!res.success || !res.data) return false;
    useAiStore.getState().loadSession(sessionId, normalizeLoadedMessages(res.data));
    return true;
  },

  async renameSession(sessionId: string, newTitle: string): Promise<boolean> {
    const ctx = currentContext();
    if (!ctx) return false;
    const { messages } = useAiStore.getState();
    const res = await aiApi.saveSession({
      companyId: ctx.companyId,
      userId: ctx.userId,
      sessionId,
      title: newTitle,
      messages,
    });
    return res.success;
  },

  async deleteSession(sessionId: string): Promise<boolean> {
    const ctx = currentContext();
    if (!ctx) return false;
    const res = await aiApi.deleteSession(ctx.companyId, ctx.userId, sessionId);
    return res.success;
  },
};
