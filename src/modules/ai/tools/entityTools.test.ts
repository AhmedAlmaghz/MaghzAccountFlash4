import { describe, it, expect, vi, beforeEach } from 'vitest';
import { entityTools } from './entityTools';

vi.mock('../engine/entityService', () => ({
  resolveEntities: vi.fn(),
}));

import { resolveEntities } from '../engine/entityService';

const mockedResolve = vi.mocked(resolveEntities);
const tool = entityTools.find((t) => t.name === 'ai.resolve_entities')!;
const ctx = { companyId: 'co1', userId: 'u1' };

describe('ai.resolve_entities — single deterministic discovery tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is registered with a read contract (never bypasses confirmation)', () => {
    expect(tool.dangerLevel).toBe('read');
    expect(tool.permission).toBe('ai.use');
    expect(tool.labelAr.trim().length).toBeGreaterThan(0);
    expect(tool.descriptionAr.trim().length).toBeGreaterThan(0);
  });

  it('rejects empty entity lists instead of fanning out', async () => {
    const out = (await tool.execute({ entities: [] }, ctx)) as { error: string };
    expect(out.error).toBeTruthy();
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('drops unknown kinds (never forwards garbage to the resolver)', async () => {
    mockedResolve.mockResolvedValue([]);
    const out = (await tool.execute(
      { entities: [{ text: 'x', kind: 'nope' }] },
      ctx,
    )) as { error: string };
    expect(out.error).toBeTruthy();
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('resolves with RBAC filtering on the model-called path', async () => {
    mockedResolve.mockResolvedValue([
      {
        request: { text: 'شركة الأمل', kind: 'customer' },
        status: 'same',
        id: 'c1',
        name: 'شركة الأمل',
        score: 0.97,
        candidates: [],
      },
    ]);
    const out = (await tool.execute(
      { entities: [{ text: 'شركة الأمل', kind: 'customer' }] },
      ctx,
    )) as { resolved: Array<{ status: string; id: string }> };
    expect(mockedResolve).toHaveBeenCalledWith(
      [{ text: 'شركة الأمل', kind: 'customer' }],
      'co1',
      { rbacFilter: true },
    );
    expect(out.resolved[0].status).toBe('same');
    expect(out.resolved[0].id).toBe('c1');
  });

  it('caps batches at 12 entities per call', async () => {
    mockedResolve.mockResolvedValue([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `كيان ${i}`, kind: 'customer' }));
    await tool.execute({ entities: many }, ctx);
    expect(vi.mocked(mockedResolve).mock.calls[0][0]).toHaveLength(12);
  });
});
