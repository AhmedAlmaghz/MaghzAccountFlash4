import { describe, it, expect, beforeAll } from 'vitest';
import { ensureToolsRegistered } from '../tools';
import { getVisibleTools, clearToolRegistry } from '../tools/registry';
import { buildSystemPrompt } from './systemPrompt';
import { selectActiveSkills } from '../skills/registry';
import { useAuthStore } from '@/modules/auth/store';
import type { Permission } from '@/modules/auth/types';

/**
 * CI GATE — prompt budget (P0-1 class).
 *
 * electron/aiHandler.js `isValidMessages` rejects string messages over a
 * per-role ceiling (system: 48K, conversation: 20K). The composed system
 * prompt (rules + ALWAYS-ON skills + tool inventory) measured ~22-29K at
 * the 2026-09-11 audit — the flat 20K cap rejected EVERY Electron AI request
 * with a misleading error while the browser path (no validation) passed all
 * tests. This gate composes the REAL prompt (all tools, always-on skills)
 * and fails CI before the size can silently creep past the main-process
 * ceiling again.
 *
 * The ceiling lives here as a constant MIRROR of aiHandler.js — when you
 * change one, change both (or extract a shared constants module).
 */

/** MUST mirror electron/aiHandler.js SYSTEM_MESSAGE_MAX. */
const MAIN_PROCESS_SYSTEM_MESSAGE_MAX = 48_000;
/** Safety margin: fail BEFORE we hit the hard rejection ceiling. */
const GATE_LIMIT = MAIN_PROCESS_SYSTEM_MESSAGE_MAX * 0.9;

/** The user with the most tools gets the biggest prompt — test worst case. */
function grantAllPermissions(): void {
  // super_admin sees every module (module-access check) — the permission
  // array covers the tool-level registry filter.
  useAuthStore.setState({
    user: {
      id: 'test-user',
      username: 'admin',
      fullName: 'Admin',
      role: 'super_admin',
      companyId: '00000000-0000-0000-0000-000000000001',
      isActive: true,
    } as never,
    permissions: ['*' as Permission],
  });
}

describe('prompt budget gate (CI)', () => {
  let prompt: string;

  beforeAll(() => {
    clearToolRegistry();
    ensureToolsRegistered();
    grantAllPermissions();
    const tools = getVisibleTools();
    // Worst case: every always-on skill fires on a business-ish message.
    const skills = selectActiveSkills({
      userMessage: 'أنشئ فاتورة مبيعات واعرض تقرير المخزون ورواتب الموظفين',
      visibleTools: tools,
    });
    prompt = buildSystemPrompt({ tools, activeSkills: skills, liveContext: {} });
  });

  it('composes a real prompt (non-trivial size)', () => {
    expect(prompt.length).toBeGreaterThan(5_000);
  });

  it(`fits the main-process system-message ceiling (${GATE_LIMIT} gate / ${MAIN_PROCESS_SYSTEM_MESSAGE_MAX} hard)`, () => {
    expect(
      prompt.length,
      `composed system prompt is ${prompt.length} chars — exceeds the 48K Electron ceiling (mirrored from aiHandler.js isValidMessages). Either shrink the prompt (skills/rules) or raise SYSTEM_MESSAGE_MAX in electron/aiHandler.js AND this mirror.`,
    ).toBeLessThan(GATE_LIMIT);
  });

  it('always-on skills alone stay under 20K (the old conversation-message cap)', () => {
    // The three always-on skills were ~8.7K at the audit; a 3× creep would
    // re-break the wire. Keep them honest independently.
    const skills = selectActiveSkills({ userMessage: 'استمر', visibleTools: getVisibleTools() });
    const alwaysOn = skills.filter((s) => s.loadingMode === 'always');
    const body = alwaysOn.map((s) => s.content).join('\n');
    expect(body.length).toBeLessThan(20_000);
  });
});
