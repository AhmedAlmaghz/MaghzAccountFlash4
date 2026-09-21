import { describe, expect, it } from 'vitest';
import { MAX_COMPLETION_TOKENS, STREAM_TOTAL_TIMEOUT_MS, reconstructResponseFromChunks } from './streaming';
import type { LlmStreamChunk } from '../types';

/**
 * Slice-1 equivalence lock: the production reconstructor moved verbatim
 * from chatEngine.ts into ./streaming. These tests pin the production
 * import directly (the older streamingReconstructor.test.ts exercises a
 * local mirror only).
 */
describe('streaming slice-1 equivalence', () => {
  it('concatenates content deltas', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'content', content: 'مرحبا ' },
      { type: 'content', content: 'بك' },
    ];
    expect(reconstructResponseFromChunks(chunks).content).toBe('مرحبا بك');
  });

  it('accumulates split tool-call name+args', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'call_1', function: { name: 'sales.' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { name: 'create' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, function: { arguments: '{"a":1}' } } },
    ];
    const out = reconstructResponseFromChunks(chunks);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe('sales.create');
    expect(out.toolCalls[0].arguments).toEqual({ a: 1 });
  });

  it('separates parallel calls sharing one index by id', () => {
    const chunks: LlmStreamChunk[] = [
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'a', function: { name: 'x.one' } } },
      { type: 'tool_call_delta', toolCall: { index: 0, id: 'b', function: { name: 'x.two' } } },
    ];
    expect(reconstructResponseFromChunks(chunks).toolCalls).toHaveLength(2);
  });

  it('keeps streaming budgets intact', () => {
    expect(MAX_COMPLETION_TOKENS).toBe(10240);
    expect(STREAM_TOTAL_TIMEOUT_MS).toBe(120_000);
  });
});
