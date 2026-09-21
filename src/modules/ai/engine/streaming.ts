import type { LlmCompletionData, LlmStreamChunk } from '../types';

/**
 * Unified completion budget. The three call sites (streaming, empty-stream
 * fallback, streaming-failure fallback) previously disagreed — 4096 vs
 * 10240 — so long reports were silently truncated on the streaming path but
 * not the fallback. One constant, one behaviour.
 */
export const MAX_COMPLETION_TOKENS = 10240;

/**
 * Hard ceiling for one streaming round-trip. The main process already aborts
 * provider stalls at 90s, but if the done-event itself is lost (dead IPC,
 * destroyed sender, bridge glitch) the renderer's `for await` would wait
 * FOREVER — isProcessing stuck, every later send ignored, app "frozen".
 * This watchdog abandons the drain and falls through to the non-streaming
 * fallback instead. Must exceed the main-process 90s abort.
 */
export const STREAM_TOTAL_TIMEOUT_MS = 120_000;

export type ProviderResponse = { success: boolean; data?: LlmCompletionData; error?: string };
export type StreamOutcome =
  | { outcome: 'stopped' }
  | { outcome: 'responded'; response: ProviderResponse; streamingId: string | null; streamedContent: boolean };

/**
 * Merge streaming SSE chunks into a complete LlmCompletionData response.
 * Handles content deltas and incremental tool_call deltas from OpenAI-compatible
 * streaming endpoints.
 */
export function reconstructResponseFromChunks(chunks: LlmStreamChunk[]): LlmCompletionData {
  let content = '';
  // Keyed by composite key (index or `index_id` when Gemini reuses index for parallel calls).
  const toolCallAccumulators: Record<string, {
    id: string;
    name: string;
    args: string;
    extraFunctionProps: Record<string, unknown>;
  }> = {};
  // Tracks the last composite key used per numeric index so deltas without id
  // still reach the correct accumulator.
  const indexToKey: Record<number, string> = {};
  let lastThoughtSignature: string | undefined;
  let finishReason: string | null = null;

  for (const chunk of chunks) {
    if (chunk.type === 'content' && chunk.content) {
      content += chunk.content;
    }

    if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
      const tc = chunk.toolCall;
      const idx = tc.index;

      // Determine the composite key for this delta.
      let key: string;
      const existingEntry = toolCallAccumulators[String(idx)];
      if (tc.id && existingEntry && existingEntry.id && existingEntry.id !== tc.id) {
        // Gemini reuses the same numeric index for a new parallel tool call.
        key = `${idx}_${tc.id}`;
      } else {
        key = indexToKey[idx] ?? String(idx);
      }
      indexToKey[idx] = key;
      if (!toolCallAccumulators[key]) {
        toolCallAccumulators[key] = { id: tc.id ?? '', name: '', args: '', extraFunctionProps: {} };
      }
      if (tc.id) toolCallAccumulators[key].id = tc.id;
      if (tc.function?.name) toolCallAccumulators[key].name += tc.function.name;
      if (tc.function?.arguments) toolCallAccumulators[key].args += tc.function.arguments;
      if (tc.function) {
        for (const k of Object.keys(tc.function)) {
          if (k !== 'name' && k !== 'arguments') {
            toolCallAccumulators[key].extraFunctionProps[k] = (tc.function as Record<string, unknown>)[k];
            // Gemini may put thought_signature inside the function object too.
            if (k === 'thought_signature') {
              lastThoughtSignature = (tc.function as Record<string, unknown>)[k] as string;
            }
          }
        }
      }
      if (typeof (tc as Record<string, unknown>).thought_signature === 'string') {
        lastThoughtSignature = (tc as Record<string, unknown>).thought_signature as string;
      }
    }

    // Special chunk emitted by aiHandler.js when Gemini returns
    // thought_signature at the message level instead of on the function.
    if (chunk.thoughtSignature) {
      lastThoughtSignature = chunk.thoughtSignature;
    }

    if (chunk.type === 'finish' && chunk.finishReason) {
      finishReason = chunk.finishReason;
    }
  }

  // Attach thought_signature to ALL tool call accumulators because Gemini
  // requires it on every tool_call in the history, not just the last one.
  if (lastThoughtSignature) {
    for (const acc of Object.values(toolCallAccumulators)) {
      acc.extraFunctionProps.thought_signature = lastThoughtSignature;
    }
  }

  const toolCalls = Object.values(toolCallAccumulators).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: (() => {
      try { return JSON.parse(tc.args || '{}'); } catch { return {}; }
    })(),
    function: Object.keys(tc.extraFunctionProps).length > 0 ? tc.extraFunctionProps : {},
  }));

  return {
    content: content || '',
    toolCalls,
    finishReason,
    usage: null,
  };
}
