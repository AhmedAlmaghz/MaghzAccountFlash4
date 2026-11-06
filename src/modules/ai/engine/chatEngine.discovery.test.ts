import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `app.find_tools` → adaptive expansion wiring.
 *
 * Session 2026-09-14 (2nd): the router advertises ≤48 tools but the registry
 * holds ~256 — when the model needs a tool outside its advertised window it
 * must be able to DISCOVER it (app.find_tools) and then CALL it next turn.
 * These tests pin the half that lives in the engine: discovered names join
 * `extraAdvertisedTools` (fed to both routers as the adaptive set).
 */

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  startStream: vi.fn(),
  executeToolCall: vi.fn(),
  resolveTool: vi.fn(),
  ensureToolsRegistered: vi.fn(),
  routeToolsForCycle: vi.fn(),
}));

vi.mock('../api', () => ({
  aiApi: { complete: mocks.complete, startStream: mocks.startStream },
}));

vi.mock('../tools/registry', () => ({
  getVisibleTools: vi.fn(() => []),
  toLlmTools: vi.fn(() => []),
}));
vi.mock('../tools/index', () => ({
  ensureToolsRegistered: mocks.ensureToolsRegistered,
}));

vi.mock('../entityResolver', () => ({
  resolveEntitiesInText: vi.fn(async (_text: string) => ({ all: [], highConfidence: [], corrections: [], text: _text })),
  searchEntities: vi.fn(async () => []),
  needsEntityResolution: vi.fn(() => false),
}));

vi.mock('./toolExecutor', () => ({
  executeToolCall: mocks.executeToolCall,
  resolveTool: mocks.resolveTool,
}));

// Partial mock: record every routing call (the extras set is argument #2)
// while still executing the real router.
vi.mock('./toolRouter', async () => {
  const actual = await vi.importActual<typeof import('./toolRouter')>('./toolRouter');
  mocks.routeToolsForCycle.mockImplementation(actual.routeToolsForCycle);
  return { ...actual, routeToolsForCycle: mocks.routeToolsForCycle };
});

vi.mock('./batchRunner', () => ({
  runBatch: vi.fn(async () => null),
  batchProgressLine: vi.fn(() => 'أُنجز 0 — فشل 0 — تُخطّي 0 — متبقٍ 0 (من 0)'),
  extractResultRef: vi.fn(() => null),
  isBatchActive: vi.fn(() => false),
  isAnyBatchActive: vi.fn(() => false),
}));

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
  })),
  isElectronPg: vi.fn(() => false),
}));

import { getChatEngine } from './chatEngine';
import { useAiStore } from '../store';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition } from '../types';
import type { User } from '@/modules/auth/types';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

const user: User = {
  id: '00000000-0000-0000-0000-000000000002',
  username: 'root',
  email: 'root@example.com',
  role: 'super_admin',
  isActive: true,
};

function readTool(name: string): ToolDefinition {
  return {
    name,
    labelAr: `أداة ${name}`,
    descriptionAr: `وصف ${name}`,
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({}),
  };
}

const APP_FIND = readTool('app.find_tools');
const PAYROLL = readTool('hr.get_payroll_runs');

let actualRoute: typeof import('./toolRouter').routeToolsForCycle;

beforeEach(async () => {
  vi.resetAllMocks();
  if (!actualRoute) {
    actualRoute = (await vi.importActual<typeof import('./toolRouter')>('./toolRouter')).routeToolsForCycle;
  }
  mocks.routeToolsForCycle.mockImplementation(actualRoute);
  useAuthStore.getState().logout();
  useAuthStore.getState().login(user);
  useAppStore.setState({
    activeCompany: {
      id: COMPANY_ID,
      name: 'شركة الاختبار',
      currency: 'YER',
    },
  });
  getChatEngine().reset();
  useAiStore.getState().clearMessages();
});

/** Two-turn provider script: call app.find_tools, then finish. */
function scriptFindTools(result: unknown, execOk = true): void {
  mocks.resolveTool.mockImplementation((name: string) => {
    if (name === 'app.find_tools') return APP_FIND;
    if (name === 'hr.get_payroll_runs') return PAYROLL;
    return undefined;
  });
  mocks.executeToolCall.mockResolvedValueOnce(
    execOk ? { ok: true, result } : { ok: false, error: 'فشل البحث' },
  );
  mocks.complete
    .mockResolvedValueOnce({
      success: true,
      data: {
        content: '',
        toolCalls: [{ id: 'd-1', name: 'app.find_tools', arguments: { query: 'راتب' } }],
        finishReason: 'tool_calls',
        usage: null,
      },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { content: 'وجدت الأداة', toolCalls: [], finishReason: 'stop', usage: null },
    });
}

function lastExtras(): Set<string> {
  const calls = mocks.routeToolsForCycle.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(2);
  return calls[calls.length - 1][1] as Set<string>;
}

describe('chatEngine — app.find_tools feeds adaptive expansion', () => {
  it('adds discovered names to the next cycle extras', async () => {
    scriptFindTools({ query: 'راتب', found: 1, toolNames: ['hr.get_payroll_runs'], matches: [] });

    await getChatEngine().send('هل تستطيع إدارة الرواتب؟');

    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      'app.find_tools',
      { query: 'راتب' },
      expect.objectContaining({ companyId: COMPANY_ID }),
    );
    expect(lastExtras().has('hr.get_payroll_runs')).toBe(true);
  });

  it('ignores ghost names from a compromised/hallucinated result', async () => {
    scriptFindTools({ toolNames: ['ghost.tool_1', 'hr.get_payroll_runs'] });

    await getChatEngine().send('ابحث عن الأداة');

    const extras = lastExtras();
    expect(extras.has('hr.get_payroll_runs')).toBe(true);
    expect(extras.has('ghost.tool_1')).toBe(false);
  });

  it('adds nothing when the discovery call failed', async () => {
    scriptFindTools({ toolNames: ['hr.get_payroll_runs'] }, false);

    await getChatEngine().send('ابحث عن الأداة');

    expect(lastExtras().has('hr.get_payroll_runs')).toBe(false);
  });
});
