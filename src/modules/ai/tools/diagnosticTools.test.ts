import { describe, it, expect } from 'vitest';
import { diagnosticTools } from './diagnosticTools';

function findTool(name: string) {
  return diagnosticTools.find((t) => t.name === name);
}

/**
 * Contract tests for the diagnostic surface (SQL behaviour is exercised by
 * the migration/live-DB suites; here we pin the CONTRACT: permissions, read
 * safety, parameters, and honest validation errors).
 */
describe('diagnosticTools contract', () => {
  it('registers exactly two tools with accounting.view + read danger', () => {
    expect(diagnosticTools).toHaveLength(2);
    for (const t of diagnosticTools) {
      expect(t.permission).toBe('accounting.view');
      expect(t.dangerLevel).toBe('read');
      expect(t.parameters.type).toBe('object');
    }
  });

  it('diagnose.posting_blockers rejects empty invoiceId with a search hint', async () => {
    const tool = findTool('diagnose.posting_blockers');
    expect(tool).toBeDefined();
    const res = (await tool!.execute({}, { companyId: 'c', userId: 'u' })) as Record<string, unknown>;
    expect(res.error).toMatch(/invoiceId مطلوب/);
  });

  it('diagnose.posting_blockers accepts sales/purchase invoiceType only', () => {
    const tool = findTool('diagnose.posting_blockers');
    const props = (tool!.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.invoiceType.enum).toEqual(['sales', 'purchase']);
  });

  it('diagnose.unbalanced_entries exposes optional date filters only', () => {
    const tool = findTool('diagnose.unbalanced_entries');
    const props = (tool!.parameters as { properties: Record<string, unknown>, required?: string[] }).properties;
    expect(Object.keys(props)).toEqual(['fromDate', 'toDate']);
    expect((tool!.parameters as { required?: string[] }).required).toBeUndefined();
  });

  it('both tools describe guidance output (تشخيص + إرشاد)', () => {
    for (const t of diagnosticTools) {
      expect(t.descriptionAr).toMatch(/تشخيص|فحص/);
      expect(t.descriptionAr.length).toBeGreaterThan(40);
    }
  });
});
