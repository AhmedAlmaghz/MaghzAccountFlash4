import { create } from 'zustand';
import type { ChatMessage, PendingToolCall } from './types';

/**
 * AI chat UI state — messages, processing flag, and current session.
 * sessionId is null until the conversation is first persisted; loading a
 * saved session sets it so subsequent saves update the same row.
 */
interface AiChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  sessionId: string | null;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  updateMessageContent: (messageId: string, content: string) => void;
  removeMessage: (messageId: string) => void;
  updateToolCall: (messageId: string, patch: Partial<PendingToolCall>) => void;
  setProcessing: (value: boolean) => void;
  clearMessages: () => void;
  setSessionId: (id: string | null) => void;
  loadSession: (sessionId: string, messages: ChatMessage[]) => void;
}

export const useAiStore = create<AiChatState>()((set) => ({
  messages: [],
  isProcessing: false,
  sessionId: null,

  addMessage: (msg) => {
    const id = crypto.randomUUID();
    const message: ChatMessage = { ...msg, id, createdAt: Date.now() };
    set((state) => ({ messages: [...state.messages, message] }));
    return id;
  },

  updateMessageContent: (messageId, content) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m
      ),
    })),

  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    })),

  updateToolCall: (messageId, patch) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId && m.toolCall ? { ...m, toolCall: { ...m.toolCall, ...patch } } : m
      ),
    })),

  setProcessing: (value) => set({ isProcessing: value }),

  clearMessages: () => set({ messages: [], isProcessing: false, sessionId: null }),

  setSessionId: (id) => set({ sessionId: id }),

  loadSession: (sessionId, messages) =>
    set({ sessionId, messages, isProcessing: false }),
}));
