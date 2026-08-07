import type { Permission } from '@/modules/auth/types';

/**
 * AI Harness module types.
 *
 * Two message domains:
 * - LlmMessage / LlmTool  — the OpenAI-compatible wire format sent to the provider
 * - ChatMessage           — the UI-side message rendered in the chat panel
 */

// ─── LLM wire format (OpenAI-compatible) ────────────────────────────────────

export interface LlmOutgoingToolCall {
  id: string;
  type: 'function';
  /** The function call — Gemini may include extra fields like thought_signature that must round-trip. */
  function: { name: string; arguments: string; [key: string]: unknown };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LlmOutgoingToolCall[];
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema object
  };
}

export interface LlmToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Raw function object from the provider response — preserves extra fields (e.g. Gemini thought_signature). */
  function?: Record<string, unknown>;
}

export interface LlmCompletionData {
  content: string;
  toolCalls: LlmToolCallResult[];
  finishReason: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

// ─── Public AI configuration (as seen by the renderer — key always masked) ──

export interface AiPublicConfig {
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
  maskedKey: string | null;
  keySource: 'env' | 'db' | null;
}

export interface AiSaveConfigPayload {
  companyId: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled?: boolean;
}

// ─── Chat persistence ───────────────────────────────────────────────────────

export interface AiChatSessionSummary {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiSaveSessionPayload {
  companyId: string;
  userId: string;
  sessionId?: string | null;
  title: string | null;
  messages: ChatMessage[];
}

// ─── Streaming ──────────────────────────────────────────────────────────────

export interface LlmStreamChunk {
  type: 'content' | 'tool_call_delta' | 'finish' | 'tool_call_extra';
  content?: string;
  toolCall?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    thought_signature?: string;
  };
  /** Gemini thought_signature forwarded at the message level (see aiHandler.js). */
  thoughtSignature?: string;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export interface LlmCompletionStreamData {
  chunks: LlmStreamChunk[];
}

// ─── Tool definitions ───────────────────────────────────────────────────────

export interface ToolContext {
  companyId: string;
  userId: string;
}

export type ToolDangerLevel = 'read' | 'write';

export interface ToolDefinition {
  /** Unique tool name sent to the LLM, e.g. 'sales.get_invoices'. */
  name: string;
  /** Arabic description sent to the LLM (the app is Arabic-first). */
  descriptionAr: string;
  /** Short Arabic label shown in the UI when the tool runs. */
  labelAr: string;
  /** RBAC permission required to execute — checked before every run. */
  permission: Permission;
  /** 'write' tools always require explicit user confirmation. */
  dangerLevel: ToolDangerLevel;
  /** JSON Schema object describing the tool parameters (sent to the LLM). */
  parameters: Record<string, unknown>;
  /**
   * Human-readable summary of a call — shown on the confirmation card
   * before execution of write tools.
   */
  summarizeArgs?: (args: Record<string, unknown>) => string;
  /** Executes the tool against module APIs. companyId/userId injected via ctx. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ─── UI chat messages ───────────────────────────────────────────────────────

export type ToolCallStatus =
  | 'pending-confirmation'
  | 'executing'
  | 'success'
  | 'error'
  | 'rejected';

export interface PendingToolCall {
  callId: string;
  toolName: string;
  label: string;
  args: Record<string, unknown>;
  argsSummary?: string;
  status: ToolCallStatus;
  dangerLevel: ToolDangerLevel;
  /** Compact string summary of the execution result (success or error). */
  resultSummary?: string;
}

export type ChatMessageKind = 'text' | 'tool' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: ChatMessageKind;
  content: string;
  toolCall?: PendingToolCall;
  createdAt: number;
}
