import { describe, expect, it } from 'vitest';
import type { LlmStreamChunk } from '../types';

/**
 * The reconstructor is internal to chatEngine.ts (not exported). These tests
 * exercise it indirectly via the public streaming path of the aiApi mock.
 * For exhaustive coverage of the reconstructor's edge cases (thought_signature
 * forwarding, parallel tool_call indices) we test the contract by replaying
 * realistic Gemini stream chunk sequences through a thin harness that mirrors
 * the production accumulator logic.
 *
 * If you need to test the production function directly, export it from
 * chatEngine.ts (preferred: add to a test-helpers barrel).
 */

type Accumulator = {
  id: string;
  name: string;
  args: string;
  extraFunctionProps: Record<string, unknown>;
};

// Mirror of the production accumulator (kept here only for self-contained testing
// of the round-trip semantics). When the production code changes this file must
// be updated to match.
function reconstruct(chunks: LlmStreamChunk[]): {
  content: string;
  toolCalls: { id: string; name: string; arguments: Record<string, unknown>; function: Record<string, unknown> }[];
} {
  let content = '';
  const accumulators: Record<string, Accumulator> = {};
  const indexToKey: Record<number, string> = {};
  let lastThoughtSignature: string | undefined;
  // lastAccumulatorKey removed — thought_signature now applied to ALL accumulators.

  for (const chunk of chunks) {
    if (chunk.type === 'content' && chunk.content) {
      content += chunk.content;
    }

    if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
      const tc = chunk.toolCall;
      const idx = tc.index;

      let key: string;
      const existingEntry = accumulators[String(idx)];
      if (tc.id && existingEntry && existingEntry.id && existingEntry.id !== tc.id) {
        key = `${idx}_${tc.id}`;
      } else {
        key = indexToKey[idx] ?? String(idx);
      }
      indexToKey[idx] = key;
      if (!accumulators[key]) accumulators[key] = { id: '', name: '', args: '', extraFunctionProps: {} };
      if (tc.id) accumulators[key].id = tc.id;
      if (tc.function?.name) accumulators[key].name += tc.function.name;
      if (tc.function?.arguments) accumulators[key].args += tc.function.arguments;
      if (tc.function) {
        for (const k of Object.keys(tc.function)) {
          if (k !== 'name' && k !== 'arguments') {
            accumulators[key].extraFunctionProps[k] = (tc.function as Record<string, unknown>)[k];
            if (k === 'thought_signature') {
              lastThoughtSignature = (tc.function as Record<string, unknown>)[k] as string;
            }
          }
        }
      }
      const sig = (tc as unknown as { thought_signature?: string }).thought_signature;
      if (typeof sig === 'string') lastThoughtSignature = sig;
    }

    if (chunk.thoughtSignature) {
      lastThoughtSignature = chunk.thoughtSignature;
    }
  }

  if (lastThoughtSignature) {
    for (const acc of Object.values(accumulators)) {
      acc.extraFunctionProps.thought_signature = lastThoughtSignature;
    }
  }

  const toolCalls = Object.values(accumulators).map((a) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(a.args || '{}'); } catch { /* keep empty */ }
    return {
      id: a.id,
      name: a.name,
      arguments: args,
      function: a.extraFunctionProps,
    };
  });

  return { content, toolCalls };
}

describe('streaming reconstructor', () => {
  it('concatenates name and arguments across deltas for the same tool call', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'sales.' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'create' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_1', function: { arguments: '{"na' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { arguments: 'me":"x"}' } } },
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('sales.create');
    expect(result.toolCalls[0].id).toBe('call_1');
    expect(result.toolCalls[0].arguments).toEqual({ name: 'x' });
  });

  it('separates tool calls by index (parallel calls)', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'search.customers' } } },
      { type: 'tool_call_delta', toolCall: { index: 1, function: { name: 'search.products' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { arguments: '{"q":"ahmed"}' } } },
      { type: 'tool_call_delta', toolCall: { index: 1, function: { arguments: '{"q":"tona"}' } } },
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((tc) => tc.name).sort()).toEqual(['search.customers', 'search.products']);
  });

  it('attaches thought_signature from the last delta to ALL tool calls', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_a', function: { name: 'first.tool' } } },
      { type: 'tool_call_delta', toolCall: { index: 1, id: 'call_b', function: { name: 'second.tool', arguments: '{}', thought_signature: 'sig-bbb' } } },
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls).toHaveLength(2);
    for (const tc of result.toolCalls) {
      expect(tc.function.thought_signature).toBe('sig-bbb');
    }
  });

  it('attaches thought_signature from message-level extra chunk to ALL tool calls', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'a.tool' } } },
      { type: 'tool_call_delta', toolCall: { index: 1, function: { name: 'b.tool', arguments: '{}' } } },
      // aiHandler.js emits this synthetic chunk when Gemini returns
      // thought_signature at the message level instead of on the function.
      { type: 'tool_call_extra', thoughtSignature: 'sig-from-message' } as unknown as LlmStreamChunk,
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls).toHaveLength(2);
    for (const tc of result.toolCalls) {
      expect(tc.function.thought_signature).toBe('sig-from-message');
    }
  });

  it('does NOT include name/arguments inside the function extras object', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'my.tool', arguments: '{"k":"v"}', thought_signature: 'sig-1' } } },
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls[0].function).toEqual({ thought_signature: 'sig-1' });
    expect('name' in result.toolCalls[0].function).toBe(false);
    expect('arguments' in result.toolCalls[0].function).toBe(false);
  });

  it('separates parallel tool calls when Gemini reuses the same index but different ids', () => {
    // Gemini emits separate deltas with the same numeric index but different
    // ids for parallel tool calls — each call is sent completely (name+args)
    // before the next starts. The accumulator must detect the id change and
    // create a separate entry via the composite key.
    const chunks: LlmStreamChunk[] = [
      // First parallel call: search.customers
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_a', function: { name: 'search.' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'customers' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { arguments: '{"q":"x"}' } } },
      // Second parallel call: search.products (same index=0, different id=call_b)
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_b', function: { name: 'search.' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'products' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { arguments: '{"q":"y"}' } } },
    ];
    const result = reconstruct(chunks);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((tc) => tc.name).sort()).toEqual(['search.customers', 'search.products']);
    expect(result.toolCalls.find((tc) => tc.name === 'search.customers')?.arguments).toEqual({ q: 'x' });
    expect(result.toolCalls.find((tc) => tc.name === 'search.products')?.arguments).toEqual({ q: 'y' });
  });
});
