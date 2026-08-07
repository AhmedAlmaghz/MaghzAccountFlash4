import type { Skill } from './types';
import type { ToolDefinition } from '../types';

/**
 * Skill Registry — central catalogue of all available skills.
 *
 * Mirrors the design of the tool registry (see `tools/registry.ts`):
 *  - Register once at app startup
 *  - Query at chat time to filter relevant skills
 */

const skills = new Map<string, Skill>();

export function registerSkill(def: Skill): void {
  if (skills.has(def.id)) {
    // Idempotent re-registration: skip silently (dev hot-reload safe).
    return;
  }
  skills.set(def.id, def);
}

export function registerSkills(defs: Skill[]): void {
  for (const def of defs) registerSkill(def);
}

export function getSkill(id: string): Skill | undefined {
  return skills.get(id);
}

export function getAllSkills(): Skill[] {
  return [...skills.values()];
}

/** Skills with loadingMode === 'always' — applied to every chat. */
export function getAlwaysOnSkills(): Skill[] {
  return getAllSkills().filter((s) => s.loadingMode === 'always');
}

/**
 * Filter trigger-based skills against a user message.
 *
 * Matches case-insensitively on any keyword in `triggers[]`.
 * Excludes skills whose `appliesWithTools` returns false for the current
 * tool visibility.
 */
export function getTriggeredSkills(
  userMessage: string,
  visibleTools: ToolDefinition[]
): Skill[] {
  const msg = userMessage.toLowerCase();
  return getAllSkills()
    .filter((s) => s.loadingMode === 'trigger')
    .filter((s) => (s.triggers || []).some((t) => msg.includes(t.toLowerCase())))
    .filter((s) => (s.appliesWithTools ? s.appliesWithTools(visibleTools) : true));
}

/**
 * Compose the final skills block to inject into the system prompt.
 *
 * Order:
 *  1. always-on skills (sorted by priority desc)
 *  2. matched trigger skills (sorted by priority desc)
 *  3. explicitly-enabled manual skills (passed as `manualIds`)
 *
 * De-duplicates by id.
 */
export function selectActiveSkills(opts: {
  userMessage: string;
  visibleTools: ToolDefinition[];
  manualIds?: string[];
}): Skill[] {
  const { userMessage, visibleTools, manualIds = [] } = opts;
  const map = new Map<string, Skill>();

  for (const s of getAlwaysOnSkills()) {
    if (!s.appliesWithTools || s.appliesWithTools(visibleTools)) {
      map.set(s.id, s);
    }
  }

  for (const s of getTriggeredSkills(userMessage, visibleTools)) {
    map.set(s.id, s);
  }

  for (const id of manualIds) {
    const s = getSkill(id);
    if (s) map.set(id, s);
  }

  return [...map.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** Render a list of skills as a Markdown block ready for the system prompt. */
export function renderSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map((s, i) => {
    const header = `### مهارة ${i + 1}: ${s.nameAr}\n*${s.descriptionAr}*`;
    const examples = s.examples && s.examples.length > 0
      ? '\n\n**أمثلة:**\n' + s.examples
          .map((ex) => `> **مستخدم:** ${ex.user}\n> **مساعد:** ${ex.assistant}`)
          .join('\n\n')
      : '';
    return `${header}\n\n${s.content}${examples}`;
  });
  return `\n\n---\n\n## مهارات متخصصة (Skills)\n\n${blocks.join('\n\n---\n\n')}\n`;
}

/** Test helper — clears the registry between test runs. */
export function clearSkillRegistry(): void {
  skills.clear();
}
