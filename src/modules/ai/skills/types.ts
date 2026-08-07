import type { ToolDefinition } from '../types';

/**
 * Skill — Dynamic system prompt modifier
 *
 * Skills extend the AI's knowledge/behavior for specific domains
 * (accounting, reporting, language, business rules). Unlike Tools
 * (which execute actions), Skills shape *how* the model thinks.
 *
 * Skills are loaded into the system prompt dynamically:
 *  - "always" — loaded for every chat session
 *  - "trigger" — loaded when user message contains matching keywords
 *  - "manual" — loaded only when explicitly requested
 *
 * Each Skill contributes a `content` block (Markdown) injected into the
 * system prompt between the base prompt and the tool list.
 */

export type SkillLoadingMode = 'always' | 'trigger' | 'manual';

export interface SkillExample {
  /** The user's request (Arabic preferred for this app). */
  user: string;
  /** The ideal AI response. */
  assistant: string;
}

export interface Skill {
  /** Unique identifier used for de-duplication and registry lookups. */
  id: string;
  /** Short Arabic label shown in admin UI / debug logs. */
  nameAr: string;
  /** Single-line description (Arabic). */
  descriptionAr: string;
  /**
   * When this skill should be loaded. Default: 'trigger'.
   *  - 'always':  appended to every system prompt
   *  - 'trigger': loaded when user message matches any `triggers[]` keyword
   *  - 'manual':  only when explicitly enabled by code (e.g. user setting)
   */
  loadingMode: SkillLoadingMode;
  /** Lowercase keywords that activate this skill (used in 'trigger' mode). */
  triggers?: string[];
  /** The actual prompt content injected as Markdown. */
  content: string;
  /** Optional few-shot examples appended after the content. */
  examples?: SkillExample[];
  /** Used to resolve conflicts when multiple skills match. Higher = earlier. */
  priority?: number;
  /** Tags for grouping (accounting | reporting | language | crm | hr | inventory). */
  tags?: string[];
  /**
   * Optional compatibility check — receives the list of tools currently
   * visible to the user. Return `false` to suppress this skill (e.g. when
   * no relevant tools exist).
   */
  appliesWithTools?: (tools: ToolDefinition[]) => boolean;
}
