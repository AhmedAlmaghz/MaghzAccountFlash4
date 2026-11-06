import { describe, it, expect, beforeAll } from 'vitest';
import { ensureToolsRegistered } from '../tools';
import { clearToolRegistry, getAllTools } from '../tools/registry';
import { buildSystemPrompt } from './systemPrompt';
import { useAuthStore } from '@/modules/auth/store';

/**
 * CI GATE — every concrete tool name mentioned in the system prompt must be
 * registered.
 *
 * The prompt is the model's map: naming a non-existent tool (`read.balance_sheet`,
 * `read.low_stock_alert`, …) makes it burn a whole turn on an unknown tool and
 * then guess. That class of drift already shipped once (2026-10 audit), so it is
 * pinned statically here. Domain prefixes followed by `*` (e.g. `search.*`,
 * `read.*`) are prose, not tool names, and are ignored by the extractor.
 */

/** Tokens that look like `domain.tool` but are SETTING keys, not tools. */
const SETTING_KEYS = new Set([
  'tax.country_code',
  'ai.token_budget_per_session',
  'invoice.showVat',
  'invoice.showDiscount',
  // Deliberately mentioned as a NON-existent name in rule 53 ("there is no
  // tool called inventory.get_warehouses") — teaching the model the correct
  // search.warehouses path.
  'inventory.get_warehouses',
]);

const TOOL_NAME_RE =
  /\b(app|core|ai|sales|purchases|inventory|hr|crm|manufacturing|accounting|settings|tax|pos|reports|read|search|diagnose|jev)\.[a-z0-9_]+\b/g;

function grantAllPermissions(): void {
  useAuthStore.setState({
    user: {
      id: 'test-user',
      username: 'admin',
      fullName: 'Admin',
      role: 'super_admin',
      companyId: '00000000-0000-0000-0000-000000000001',
      isActive: true,
    } as never,
    permissions: [],
  });
}

describe('system prompt tool-name gate (CI)', () => {
  let prompt: string;
  let registered: Set<string>;

  beforeAll(() => {
    clearToolRegistry();
    ensureToolsRegistered();
    grantAllPermissions();
    prompt = buildSystemPrompt({ tools: getAllTools(), activeSkills: [], liveContext: {} });
    registered = new Set(getAllTools().map((t) => t.name));
  });

  it('mentions at least a handful of tools (sanity)', () => {
    const mentioned = new Set((prompt.match(TOOL_NAME_RE) ?? []).filter((n) => !SETTING_KEYS.has(n)));
    expect(mentioned.size).toBeGreaterThan(10);
  });

  it('every concrete tool name mentioned in the prompt is registered', () => {
    const mentioned = new Set(
      (prompt.match(TOOL_NAME_RE) ?? []).filter((n) => !SETTING_KEYS.has(n)),
    );
    const missing = [...mentioned].filter((n) => !registered.has(n));
    expect(
      missing,
      `the prompt references tools that do not exist: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('does not reference the retired generic read.* report aliases', () => {
    for (const ghost of [
      'read.customer_statement',
      'read.ar_aging',
      'read.low_stock_alert',
      'read.balance_sheet',
    ]) {
      expect(prompt).not.toContain(ghost);
    }
  });
});
