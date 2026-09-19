import { describe, it, expect, beforeAll } from 'vitest';
import { ensureSkillsRegistered } from './index';
import { getSkill, selectActiveSkills } from './registry';
import { posAssistantSkill } from './posAssistant';
import { taxComplianceSkill } from './taxCompliance';
import { fixedAssetsSkill } from './fixedAssets';

describe('new feature skills (POS / tax / fixed assets)', () => {
  beforeAll(() => {
    ensureSkillsRegistered();
  });

  it('registers posAssistant with the required id and triggers', () => {
    expect(getSkill('posAssistant')).toBe(posAssistantSkill);
    expect(posAssistantSkill.loadingMode).toBe('trigger');
    for (const t of ['نقطة بيع', 'كاشير', 'وردية', 'شيفت', 'إيصال', 'pos', 'cashier', 'shift', 'receipt', 'z-report']) {
      expect(posAssistantSkill.triggers).toContain(t);
    }
  });

  it('registers taxCompliance with the required id and triggers', () => {
    expect(getSkill('taxCompliance')).toBe(taxComplianceSkill);
    expect(taxComplianceSkill.loadingMode).toBe('trigger');
    for (const t of ['ضريبة', 'السعودية', 'الإمارات', 'مصر', 'اليمن', 'إقرار', 'VAT', 'vat', 'tax', 'country', 'return', 'period']) {
      expect(taxComplianceSkill.triggers?.map((x) => x.toLowerCase())).toContain(t.toLowerCase());
    }
  });

  it('registers fixedAssets with the required id and triggers', () => {
    expect(getSkill('fixedAssets')).toBe(fixedAssetsSkill);
    expect(fixedAssetsSkill.loadingMode).toBe('trigger');
    for (const t of ['أصل', 'أصول', 'إهلاك', 'إقفال', 'سنة مالية', 'fixed asset', 'depreciation', 'year-end', 'close', 'fiscal']) {
      expect(fixedAssetsSkill.triggers?.map((x) => x.toLowerCase())).toContain(t.toLowerCase());
    }
  });

  it('fires posAssistant on cashier intent', () => {
    const active = selectActiveSkills({ userMessage: 'افتح وردية الكاشير', visibleTools: [] });
    expect(active.map((s) => s.id)).toContain('posAssistant');
  });

  it('fires taxCompliance on VAT-return intent', () => {
    const active = selectActiveSkills({ userMessage: 'اعرض الإقرار الضريبي', visibleTools: [] });
    expect(active.map((s) => s.id)).toContain('taxCompliance');
  });

  it('fires fixedAssets on depreciation intent', () => {
    const active = selectActiveSkills({ userMessage: 'شغّل إهلاك الشهر', visibleTools: [] });
    expect(active.map((s) => s.id)).toContain('fixedAssets');
  });

  it('posAssistant content covers the shift lifecycle and never-invent-shiftId', () => {
    const c = posAssistantSkill.content;
    expect(c).toContain('pos.get_active_shift');
    expect(c).toContain('pos.checkout_sale');
    expect(c).toContain('pos.get_shift_summary');
    expect(c).toMatch(/لا تخترع shiftId|never invent shiftId/i);
  });

  it('taxCompliance content covers country profiles and JE-leg returns', () => {
    const c = taxComplianceSkill.content;
    expect(c).toContain('SA');
    expect(c).toContain('15%');
    expect(c).toContain('YE');
    expect(c).toContain('tax.country_code');
  });

  it('fixedAssets content covers preview-before-close and depreciation', () => {
    const c = fixedAssetsSkill.content;
    expect(c).toContain('accounting.close_fiscal_year');
    expect(c).toContain('previewOnly');
    expect(c).toContain('accounting.run_depreciation');
  });
});
