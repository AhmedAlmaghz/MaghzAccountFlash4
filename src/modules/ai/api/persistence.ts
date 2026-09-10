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
  return messages.filter((m): m is ChatMessage => !!m && typeof m.role === 'string').map((m) => {
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
  const firstUser = messages.find((m) => m && m.role === 'user' && m.content?.trim());
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

/**
 * Cheap fingerprint of a conversation snapshot. Saves are full rewrites
 * (DELETE + batch INSERT), so we skip them entirely when nothing observable
 * changed since the last successful save — the 60s autosave and the
 * end-of-cycle save become no-ops instead of O(N) writes.
 */
function snapshotFingerprint(sessionId: string | null, messages: ChatMessage[]): string {
  if (messages.length === 0) return `${sessionId ?? '∅'}|0`;
  const last = messages[messages.length - 1];
  if (!last || typeof last.id !== 'string') return `${sessionId ?? '∅'}|${messages.length}|corrupt`;
  return [
    sessionId ?? '∅',
    messages.length,
    last.id,
    (last.content || '').length,
    last.toolCall?.status ?? '',
    last.attachments?.length ?? 0,
  ].join('|');
}

let lastSavedFingerprint: string | null = null;
let saveInFlight: Promise<boolean> | null = null;
let saveRequestedWhileInFlight = false;

async function runSave(): Promise<boolean> {
  const ctx = currentContext();
  if (!ctx) return false;
  const { messages, sessionId, setSessionId } = useAiStore.getState();
  if (messages.length === 0) return false;

  const fingerprint = snapshotFingerprint(sessionId, messages);
  if (fingerprint === lastSavedFingerprint) return true;

  const title = deriveTitle(messages);
  const snapshot = messages;

  const res = await aiApi.saveSession({
    companyId: ctx.companyId,
    userId: ctx.userId,
    sessionId,
    title,
    messages: snapshot,
  });
  if (!res.success) {
    // Surface instead of swallowing: an autosave that silently fails loses
    // the whole conversation on close with no hint why the history is empty.
    console.error('[ai/persistence] session save failed:', res.error);
    return false;
  }
  if (res.data?.sessionId) {
    // Stamp the id ONLY if the store still holds the conversation we saved.
    // handleNewChat/handleSelectSession fire-and-forget a save and switch
    // immediately; stamping afterwards would attach the OLD session id to the
    // NEW conversation, and the next save would then DELETE the old session's
    // messages and overwrite its row — sessions silently merging/dying.
    if (useAiStore.getState().sessionId === sessionId) {
      setSessionId(res.data.sessionId);
      lastSavedFingerprint = snapshotFingerprint(res.data.sessionId, snapshot);
    }
  }
  return true;
}

export const aiPersistence = {
  /**
   * Persist the current conversation (create or replace). Fire-and-forget
   * safe: snapshots the store synchronously, skips when unchanged, and
   * serializes overlapping calls (one in flight + one queued) so a slow save
   * is never duplicated but fresh data is never dropped either.
   * Returns false when the save failed (the caller may surface a warning).
   */
  async saveCurrentSession(): Promise<boolean> {
    if (saveInFlight) {
      saveRequestedWhileInFlight = true;
      return saveInFlight;
    }
    const run = (async (): Promise<boolean> => {
      let ok = true;
      try {
        ok = (await runSave()) && ok;
        // A newer state arrived while saving → persist it too (once).
        while (saveRequestedWhileInFlight) {
          saveRequestedWhileInFlight = false;
          ok = (await runSave()) && ok;
        }
        return ok;
      } finally {
        saveInFlight = null;
      }
    })();
    saveInFlight = run;
    return run;
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
    // Different conversation in the store now — the saved fingerprint (if any)
    // belongs to the previous one.
    lastSavedFingerprint = snapshotFingerprint(sessionId, useAiStore.getState().messages);
    return true;
  },

  /**
   * Rename a session — title-only UPDATE. The previous implementation saved
   * the CURRENTLY OPEN conversation under the renamed session's id, silently
   * destroying that session's messages.
   */
  async renameSession(sessionId: string, newTitle: string): Promise<boolean> {
    const ctx = currentContext();
    if (!ctx) return false;
    const res = await aiApi.renameSession({
      sessionId,
      title: newTitle,
      companyId: ctx.companyId,
      userId: ctx.userId,
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
