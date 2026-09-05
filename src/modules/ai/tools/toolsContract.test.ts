import { describe, it, expect, beforeAll } from 'vitest';
import { ensureToolsRegistered } from './index';
import { getAllTools, clearToolRegistry } from './registry';
import type { ToolDefinition } from '../types';
import { ALL_PERMISSIONS } from '@/modules/auth/types';

/**
 * CI GATE — contract scan over EVERY registered tool definition.
 *
 * These rules encode the P0 audit findings (2026-09):
 *   1. A write tool must never be gated by a *.view permission —
 *      that is privilege escalation (settings.view users could mutate).
 *   2. Every permission must be a member of the Permission union —
 *      a typo silently degrades to "nobody can run this" (or worse,
 *      wildcard leaks through hasPermission fallbacks).
 *   3. Tool names must be unique and namespaced (domain.verb).
 *   4. Write tools must define summarizeArgs so the confirmation card
 *      shows substance the user can verify before consenting.
 *   5. Read tools must never create/modify — enforced lexically as a
 *      tripwire: a read tool whose name starts with create/update/delete
 *      is a misclassification that bypasses user confirmation entirely.
 *   6. Verb→permission alignment: update_* requires *.edit, delete_*
 *      requires *.delete, post_* requires *.post (or *.edit where the
 *      module defines no post grant). Composite wizards that post
 *      (create_and_post_*, create_journal_flow) are allowlisted on their
 *      STRONGEST action so a create-only role can never post through them.
 */

const VIEW_PERMISSIONS = new Set(
  ALL_PERMISSIONS.filter((p) => p.endsWith('.view') || p.endsWith('.own')),
);

const WRITE_ACTION_RE = /^(create|update|delete|post|apply|deactivate|win|complete|pay|save)_/;

describe('AI tools contract gate (CI)', () => {
  let tools: ToolDefinition[];

  beforeAll(() => {
    clearToolRegistry();
    ensureToolsRegistered();
    tools = getAllTools();
  });

  it('has a non-empty registry', () => {
    expect(tools.length).toBeGreaterThan(100);
  });

  it('every write tool is gated by a WRITE permission (never *.view/*.own)', () => {
    const violations = tools.filter(
      (t) => t.dangerLevel === 'write' && VIEW_PERMISSIONS.has(t.permission),
    );
    expect(
      violations.map((v) => `${v.name} -> ${v.permission}`),
      'WRITE tools gated by view-only permissions are privilege escalation',
    ).toEqual([]);
  });

  it('every write tool permission is a create/edit/delete/post-style grant', () => {
    // The allowed grants for mutation are module.create/edit/delete/post,
    // settings.edit/users/roles, core.edit, ai.* — never a pure read grant.
    const WRITE_GRANTS = /^(?:core\.edit|settings\.(?:edit|users|roles)|ai\.(?:use|settings)|[a-z]+\.(?:create|edit|delete|post))$/;
    const violations = tools
      .filter((t) => t.dangerLevel === 'write')
      .filter((t) => !WRITE_GRANTS.test(t.permission));
    expect(
      violations.map((v) => `${v.name} -> ${v.permission}`),
      'write tools must use create/edit/delete/post grants (or settings.edit)',
    ).toEqual([]);
  });

  it('every tool permission exists in the Permission union (no typos)', () => {
    const valid = new Set<string>([...ALL_PERMISSIONS, '*']);
    const violations = tools.filter((t) => !valid.has(t.permission));
    expect(
      violations.map((v) => `${v.name} -> ${v.permission}`),
    ).toEqual([]);
  });

  it('tool names are unique', () => {
    const names = tools.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('tool names are namespaced (domain.verb)', () => {
    const violations = tools.filter((t) => !/^[a-z][a-z0-9]*\.[a-z0-9_]+$/.test(t.name));
    expect(violations.map((v) => v.name)).toEqual([]);
  });

  it('every write tool defines summarizeArgs (confirmation-card substance)', () => {
    const violations = tools
      .filter((t) => t.dangerLevel === 'write')
      .filter((t) => typeof t.summarizeArgs !== 'function');
    expect(
      violations.map((v) => v.name),
      'a write tool without summarizeArgs shows a bare confirmation card',
    ).toEqual([]);
  });

  it('no READ tool is named like a mutation (misclassification tripwire)', () => {
    const violations = tools
      .filter((t) => t.dangerLevel === 'read')
      .filter((t) => WRITE_ACTION_RE.test(t.name.split('.')[1] ?? ''));
    expect(
      violations.map((v) => `${v.name} (read)`),
      'mutation-named tools marked read bypass user confirmation',
    ).toEqual([]);
  });

  it('verb matches permission strength (update→edit, delete→delete, post→post)', () => {
    // Modules that define a post grant — everywhere else posting falls back
    // to the edit grant (purchases / inventory / hr have no *.post).
    const MODULES_WITH_POST = new Set(['sales', 'accounting', 'manufacturing']);
    // Composite wizards gated on their strongest action (intentional).
    const COMPOSITE_ALLOWLIST: Record<string, string> = {
      'sales.create_and_post_invoice': 'sales.post',
      'purchases.create_and_post_invoice': 'purchases.edit',
      'accounting.create_journal_flow': 'accounting.post',
    };
    const violations: string[] = [];
    for (const t of tools.filter((x) => x.dangerLevel === 'write')) {
      const [module, ...rest] = t.name.split('.');
      const verb = rest.join('_').split('_')[0];
      const suffix = t.permission.split('.').pop() ?? '';
      if (module === 'settings') {
        if (t.permission !== 'settings.edit' && t.permission !== 'settings.view') {
          violations.push(`${t.name} -> ${t.permission} (settings tools use settings.edit)`);
        }
        continue;
      }
      const allowed = COMPOSITE_ALLOWLIST[t.name];
      if (allowed) {
        if (t.permission !== allowed) violations.push(`${t.name} -> ${t.permission} (want ${allowed})`);
        continue;
      }
      if (verb === 'create' && suffix !== 'create') violations.push(`${t.name} -> ${t.permission} (want .create)`);
      if (verb === 'update' && suffix !== 'edit') violations.push(`${t.name} -> ${t.permission} (want .edit)`);
      if (verb === 'delete' && suffix !== 'delete') violations.push(`${t.name} -> ${t.permission} (want .delete)`);
      if (verb === 'post' && suffix !== (MODULES_WITH_POST.has(module) ? 'post' : 'edit')) {
        violations.push(`${t.name} -> ${t.permission} (want .${MODULES_WITH_POST.has(module) ? 'post' : 'edit'})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('every tool has a non-empty Arabic label and description', () => {
    const violations = tools.filter(
      (t) => !t.labelAr?.trim() || !t.descriptionAr?.trim(),
    );
    expect(violations.map((v) => v.name)).toEqual([]);
  });

  it('parameters are valid JSON-Schema objects', () => {
    const violations = tools.filter(
      (t) => !t.parameters || t.parameters.type !== 'object',
    );
    expect(violations.map((v) => v.name)).toEqual([]);
  });
});
