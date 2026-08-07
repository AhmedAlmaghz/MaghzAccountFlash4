import type {
  AiChatSessionSummary,
  AiPublicConfig,
  AiSaveConfigPayload,
  AiSaveSessionPayload,
  ChatMessage,
  LlmCompletionData,
  LlmMessage,
  LlmStreamChunk,
  LlmTool,
} from '../types';

/**
 * Renderer-side client for the AI Harness IPC bridge (window.electronAI).
 * The bridge is exposed by electron/preload.cjs; outside Electron (web/e2e
 * without a shim) the module degrades gracefully via isAvailable().
 */

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

type StreamChunkCallback = (chunk: LlmStreamChunk) => void;
type StreamDoneCallback = (result: { success: boolean; error?: string }) => void;

interface ElectronAI {
  getConfig: (companyId: string) => Promise<IpcResult<AiPublicConfig>>;
  saveConfig: (payload: AiSaveConfigPayload) => Promise<IpcResult<void>>;
  testConnection: (payload: {
    companyId: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }) => Promise<IpcResult<{ model: string }>>;
  complete: (payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
  }) => Promise<IpcResult<LlmCompletionData>>;
  startStream: (payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
  }) => void;
  onStreamChunk: (callback: StreamChunkCallback) => void;
  onStreamDone: (callback: StreamDoneCallback) => void;
  removeStreamListeners: () => void;
  listSessions: (payload: { companyId: string; userId: string }) => Promise<IpcResult<AiChatSessionSummary[]>>;
  getSessionMessages: (payload: { companyId: string; sessionId: string }) => Promise<IpcResult<ChatMessage[]>>;
  saveSession: (payload: AiSaveSessionPayload) => Promise<IpcResult<{ sessionId: string }>>;
  deleteSession: (payload: { companyId: string; userId: string; sessionId: string }) => Promise<IpcResult<void>>;
}

declare global {
  interface Window {
    electronAI?: ElectronAI;
  }
}

const NOT_AVAILABLE = 'AI bridge is not available (desktop app required)';

function bridge(): ElectronAI | null {
  if (typeof window !== 'undefined' && window.electronAI) return window.electronAI;
  return null;
}

export const aiApi = {
  isAvailable(): boolean {
    return bridge() !== null;
  },

  async getConfig(companyId: string): Promise<IpcResult<AiPublicConfig>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.getConfig(companyId);
  },

  async saveConfig(payload: AiSaveConfigPayload): Promise<IpcResult<void>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.saveConfig(payload);
  },

  async testConnection(payload: {
    companyId: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<IpcResult<{ model: string }>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.testConnection(payload);
  },

  async complete(payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<IpcResult<LlmCompletionData>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.complete(payload);
  },

  /**
   * Push-based streaming via async generator.
   * Yields each LlmStreamChunk as it arrives from the main process,
   * then returns { success, error } when the stream completes.
   *
   * Usage:
   *   const gen = aiApi.startStream({ companyId, messages, tools });
   *   for await (const chunk of gen) {
   *     // update UI progressively
   *   }
   */
  startStream(payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
  }): AsyncGenerator<LlmStreamChunk, { success: boolean; error?: string }, void> {
    const b = bridge();
    if (!b) throw new Error('AI bridge is not available');

    let done = false;
    let doneResult: { success: boolean; error?: string } = { success: false, error: 'stream ended unexpectedly' };
    const queue: LlmStreamChunk[] = [];
    let resolveNext: ((value: LlmStreamChunk | { __done__: true; result: { success: boolean; error?: string } }) => void) | null = null;

    b.onStreamChunk((chunk) => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(chunk);
      } else {
        queue.push(chunk);
      }
    });

    b.onStreamDone((result) => {
      done = true;
      doneResult = result;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ __done__: true, result });
      }
    });

    b.startStream(payload);

    const generator: AsyncGenerator<LlmStreamChunk, { success: boolean; error?: string }, void> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          if (queue.length > 0) {
            const chunk = queue.shift()!;
            return { value: chunk, done: false };
          }
          if (done) {
            b.removeStreamListeners();
            return { value: doneResult, done: true } as { value: { success: boolean; error?: string }; done: true };
          }
          const item = await new Promise<LlmStreamChunk | { __done__: true; result: { success: boolean; error?: string } }>(
            (resolve) => { resolveNext = resolve; }
          );
          if ('__done__' in item) {
            b.removeStreamListeners();
            return { value: item.result, done: true };
          }
          return { value: item, done: false };
        }
      },
      async return() {
        b.removeStreamListeners();
        resolveNext = null;
        return { value: { success: false, error: 'stream cancelled' }, done: true };
      },
      async throw(err) {
        b.removeStreamListeners();
        resolveNext = null;
        return { value: { success: false, error: String(err) }, done: true };
      },
    };

    return generator;
  },

  async listSessions(companyId: string, userId: string): Promise<IpcResult<AiChatSessionSummary[]>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.listSessions({ companyId, userId });
  },

  async getSessionMessages(companyId: string, sessionId: string): Promise<IpcResult<ChatMessage[]>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.getSessionMessages({ companyId, sessionId });
  },

  async saveSession(payload: AiSaveSessionPayload): Promise<IpcResult<{ sessionId: string }>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.saveSession(payload);
  },

  async deleteSession(companyId: string, userId: string, sessionId: string): Promise<IpcResult<void>> {
    const b = bridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.deleteSession({ companyId, userId, sessionId });
  },
};
