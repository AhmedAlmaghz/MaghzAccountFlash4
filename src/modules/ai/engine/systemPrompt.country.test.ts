import { describe, it, expect, beforeEach } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';

describe('buildSystemPrompt — tax country context + rules 47-49', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
  });

  it('shows the tax country from liveContext alongside the VAT rate', () => {
    const prompt = buildSystemPrompt({ tools: [], liveContext: { vatRate: 15, countryCode: 'SA' } });
    expect(prompt).toContain('SA');
    expect(prompt).toContain('15%');
    expect(prompt).toContain('tax.country_code');
  });

  it('asks for the country when liveContext lacks it (no 15% assumption)', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('غير محددة');
    expect(prompt).toContain('tax.country_code');
    expect(prompt).toContain('YE اليمن 0%');
  });

  it('carries the POS rule (47): open shift first, never invent shiftId', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('pos.get_active_shift');
    expect(prompt).toMatch(/لا تخترع shiftId/);
    expect(prompt).toContain('CASH');
  });

  it('carries the tax-country rule (48): single source, YE 0% valid, JE-leg returns', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('tax.country_code) هي المصدر الوحيد');
    expect(prompt).toContain('أرجل القيود');
    expect(prompt).toContain('الفترة المغلقة');
  });

  it('carries the fixed-assets / year-end rule (49): preview first, close irreversible', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('previewOnly=true');
    expect(prompt).toContain('لا رجعة فيه');
    expect(prompt).toContain('accounting.run_depreciation');
  });
});
