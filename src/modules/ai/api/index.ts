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
import type {
  JobBatchDetail,
  JobBatchItem,
  JobBatchItemInput,
  JobBatchSummary,
} from './batchTypes';

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
  renameSession: (payload: { sessionId: string; title: string; companyId?: string; userId?: string }) => Promise<IpcResult<void>>;
  deleteSession: (payload: { companyId: string; userId: string; sessionId: string }) => Promise<IpcResult<void>>;
  batchCreate: (payload: {
    companyId: string; userId: string; title?: string | null; kind?: string;
    sessionId?: string | null; items: JobBatchItemInput[];
  }) => Promise<IpcResult<{ batchId: string; total: number; inserted: number }>>;
  batchClaim: (payload: { companyId: string; userId: string; batchId: string; limit?: number }) => Promise<IpcResult<JobBatchItem[]>>;
  batchItemDone: (payload: {
    companyId: string; userId: string; batchId: string; itemId: string; resultRef?: string | null;
  }) => Promise<IpcResult<{ finalStatus: string | null }>>;
  batchItemFail: (payload: {
    companyId: string; userId: string; batchId: string; itemId: string;
    error?: string; errorCode?: string | null; retryable?: boolean;
  }) => Promise<IpcResult<{ retried: boolean; attempts?: number; skipped?: number; finalStatus?: string | null }>>;
  batchSetStatus: (payload: {
    companyId: string; userId: string; batchId: string; status: 'paused' | 'running' | 'cancelled';
  }) => Promise<IpcResult<{ status: string; skipped: number }>>;
  batchRetryFailed: (payload: { companyId: string; userId: string; batchId: string }) => Promise<IpcResult<{ requeued: number }>>;
  batchRecover: (payload: { companyId: string; userId: string; batchId: string }) => Promise<IpcResult<{ recoveredFailed: number; recoveredSkipped: number; finalStatus: string | null }>>;
  batchGet: (payload: { companyId: string; userId: string; batchId: string }) => Promise<IpcResult<JobBatchDetail>>;
  batchList: (payload: { companyId: string; userId: string; status?: string }) => Promise<IpcResult<JobBatchSummary[]>>;
}

declare global {
  interface Window {
    electronAI?: ElectronAI;
  }
}

const NOT_AVAILABLE = 'AI bridge is not available (desktop app required)';

let browserBridgePromise: Promise<typeof import('./browserBridge').browserAiBridge> | null = null;

function loadBrowserBridge() {
  if (!browserBridgePromise) {
    browserBridgePromise = import('./browserBridge').then((m) => m.browserAiBridge);
  }
  return browserBridgePromise;
}

function bridge(): ElectronAI | null {
  if (typeof window !== 'undefined' && window.electronAI) return window.electronAI;
  return null;
}

/**
 * Returns the browser-side bridge when running in pure web/PGlite mode
 * (no Electron main process). The browser bridge implements the same
 * surface using the local PGlite DB + direct fetch to the LLM provider.
 */
async function getEffectiveBridge(): Promise<ElectronAI | null> {
  const b = bridge();
  if (b) return b;
  try {
    return (await loadBrowserBridge()) as unknown as ElectronAI;
  } catch {
    return null;
  }
}export const aiApi = {
  isAvailable(): boolean {
    return bridge() !== null;
  },

  async getConfig(companyId: string): Promise<IpcResult<AiPublicConfig>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.getConfig(companyId);
  },

  async saveConfig(payload: AiSaveConfigPayload): Promise<IpcResult<void>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.saveConfig(payload);
  },

  async testConnection(payload: {
    companyId: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<IpcResult<{ model: string }>> {
    const b = await getEffectiveBridge();
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
    const b = await getEffectiveBridge();
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
    let b: ElectronAI | null = null;
    let done = false;
    let doneResult: { success: boolean; error?: string } = { success: false, error: 'stream ended unexpectedly' };
    const queue: LlmStreamChunk[] = [];
    let resolveNext: ((value: LlmStreamChunk | { __done__: true; result: { success: boolean; error?: string } }) => void) | null = null;

    const generator: AsyncGenerator<LlmStreamChunk, { success: boolean; error?: string }, void> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        // Lazily resolve the bridge on first pull (allows async init).
        if (!b) {
          b = await getEffectiveBridge();
          if (!b) {
            return { value: { success: false, error: NOT_AVAILABLE }, done: true } as {
              value: { success: boolean; error?: string };
              done: true;
            };
          }
          b.startStream(payload);
        }

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
        if (b) b.removeStreamListeners();
        resolveNext = null;
        return { value: { success: false, error: 'stream cancelled' }, done: true };
      },
      async throw(err) {
        if (b) b.removeStreamListeners();
        resolveNext = null;
        return { value: { success: false, error: String(err) }, done: true };
      },
    };

    // Register listeners immediately so no chunks are missed while the
    // bridge resolves asynchronously.
    void getEffectiveBridge().then((resolved) => {
      if (!resolved) return;
      resolved.onStreamChunk((chunk) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(chunk);
        } else {
          queue.push(chunk);
        }
      });
      resolved.onStreamDone((result) => {
        done = true;
        doneResult = result;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ __done__: true, result });
        }
      });
    });

    return generator;
  },

  async listSessions(companyId: string, userId: string): Promise<IpcResult<AiChatSessionSummary[]>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.listSessions({ companyId, userId });
  },

  async getSessionMessages(companyId: string, sessionId: string): Promise<IpcResult<ChatMessage[]>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.getSessionMessages({ companyId, sessionId });
  },

  async saveSession(payload: AiSaveSessionPayload): Promise<IpcResult<{ sessionId: string }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.saveSession(payload);
  },

  async renameSession(params: { sessionId: string; title: string; companyId?: string; userId?: string }): Promise<IpcResult<void>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.renameSession(params);
  },

  async deleteSession(companyId: string, userId: string, sessionId: string): Promise<IpcResult<void>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.deleteSession({ companyId, userId, sessionId });
  },

  // ─── Job queue (ONE approval for MANY tool calls) ────────────────────────
  async batchCreate(payload: {
    companyId: string; userId: string; title?: string | null; kind?: string;
    sessionId?: string | null; items: JobBatchItemInput[];
  }): Promise<IpcResult<{ batchId: string; total: number; inserted: number }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchCreate(payload);
  },

  async batchClaim(companyId: string, userId: string, batchId: string, limit?: number): Promise<IpcResult<JobBatchItem[]>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchClaim({ companyId, userId, batchId, limit });
  },

  async batchItemDone(
    companyId: string, userId: string, batchId: string, itemId: string, resultRef?: string | null,
  ): Promise<IpcResult<{ finalStatus: string | null }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchItemDone({ companyId, userId, batchId, itemId, resultRef });
  },

  async batchItemFail(
    companyId: string, userId: string, batchId: string, itemId: string,
    error?: string, errorCode?: string | null, retryable?: boolean,
  ): Promise<IpcResult<{ retried: boolean; attempts?: number; skipped?: number; finalStatus?: string | null }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchItemFail({ companyId, userId, batchId, itemId, error, errorCode, retryable });
  },

  async batchSetStatus(
    companyId: string, userId: string, batchId: string, status: 'paused' | 'running' | 'cancelled',
  ): Promise<IpcResult<{ status: string; skipped: number }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchSetStatus({ companyId, userId, batchId, status });
  },

  async batchRetryFailed(companyId: string, userId: string, batchId: string): Promise<IpcResult<{ requeued: number }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchRetryFailed({ companyId, userId, batchId });
  },

  async batchRecover(companyId: string, userId: string, batchId: string): Promise<IpcResult<{ recoveredFailed: number; recoveredSkipped: number; finalStatus: string | null }>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchRecover({ companyId, userId, batchId });
  },

  async batchGet(companyId: string, userId: string, batchId: string): Promise<IpcResult<JobBatchDetail>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchGet({ companyId, userId, batchId });
  },

  async batchList(companyId: string, userId: string, status?: string): Promise<IpcResult<JobBatchSummary[]>> {
    const b = await getEffectiveBridge();
    if (!b) return { success: false, error: NOT_AVAILABLE };
    return b.batchList({ companyId, userId, status });
  },
};
