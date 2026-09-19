import { describe, it, expect } from 'vitest';
import { suggestionsForToolCall, suggestionsForText } from './suggestionEngine';

describe('suggestionEngine — POS / tax / fixed-assets routes', () => {
  it('maps pos checkout/shift tools to the POS terminal', () => {
    expect(suggestionsForToolCall('pos.checkout_sale')).toContainEqual(
      expect.objectContaining({ type: 'navigate', path: '/pos', labelKey: 'ai.actions.openPos' }),
    );
    expect(suggestionsForToolCall('pos.get_active_shift')).toContainEqual(
      expect.objectContaining({ type: 'navigate', path: '/pos' }),
    );
    expect(suggestionsForToolCall('pos.list_shifts')).toContainEqual(
      expect.objectContaining({ type: 'navigate', path: '/pos' }),
    );
  });

  it('maps the shift summary to POS reports', () => {
    expect(suggestionsForToolCall('pos.get_shift_summary')).toContainEqual(
      expect.objectContaining({ type: 'navigate', path: '/pos/reports', labelKey: 'ai.actions.openPosReports' }),
    );
  });

  it('proposes the POS receipt as the next step after checkout', () => {
    const [first] = suggestionsForToolCall('pos.checkout_sale');
    expect(first).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.viewPosReceipt' });
  });

  it('maps fixed-asset tools to the fixed-assets page', () => {
    for (const name of [
      'accounting.list_fixed_assets',
      'accounting.create_fixed_asset',
      'accounting.dispose_fixed_asset',
      'accounting.run_depreciation',
    ]) {
      expect(suggestionsForToolCall(name)).toContainEqual(
        expect.objectContaining({ type: 'navigate', path: '/accounting/fixed-assets', labelKey: 'ai.actions.openFixedAssets' }),
      );
    }
  });

  it('proposes running depreciation after creating a fixed asset', () => {
    const [first] = suggestionsForToolCall('accounting.create_fixed_asset');
    expect(first).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.runDepreciationForAsset' });
  });

  it('maps the fiscal close to the year-end page', () => {
    expect(suggestionsForToolCall('accounting.close_fiscal_year')).toContainEqual(
      expect.objectContaining({ type: 'navigate', path: '/accounting/year-end', labelKey: 'ai.actions.openYearEnd' }),
    );
  });

  it('maps tax-country settings tools to the company page', () => {
    for (const name of ['settings.get_tax_country', 'settings.set_tax_country']) {
      expect(suggestionsForToolCall(name)).toContainEqual(
        expect.objectContaining({ type: 'navigate', path: '/settings/company', labelKey: 'ai.actions.openCompany' }),
      );
    }
  });

  it('maps tax.* tools to the VAT settings page with a VAT-return next step', () => {
    expect(suggestionsForToolCall('tax.close_period')[1]).toMatchObject({
      type: 'navigate',
      path: '/settings/vat',
      labelKey: 'ai.actions.openVat',
    });
    const [first] = suggestionsForToolCall('tax.close_period');
    expect(first).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.showVatReturn' });
  });

  it('falls back to module pages for unlisted pos./tax. tools', () => {
    expect(suggestionsForToolCall('pos.unknown_future_tool')).toContainEqual(
      expect.objectContaining({ path: '/pos' }),
    );
    expect(suggestionsForToolCall('tax.unknown_future_tool')).toContainEqual(
      expect.objectContaining({ path: '/settings/vat' }),
    );
  });

  it('derives POS / asset / year-end / VAT suggestions from assistant text', () => {
    expect(suggestionsForText('توجه إلى نقطة البيع').some((s) => s.path === '/pos')).toBe(true);
    expect(suggestionsForText('سجّل إهلاك الأصول الثابتة').some((s) => s.path === '/accounting/fixed-assets')).toBe(true);
    expect(suggestionsForText('نفّذ الإقفال السنوي').some((s) => s.path === '/accounting/year-end')).toBe(true);
    expect(suggestionsForText('اعرض الإقرار الضريبي').some((s) => s.path === '/settings/vat')).toBe(true);
  });

  it('still caps new-feature suggestions at 3 chips', () => {
    for (const name of ['pos.checkout_sale', 'accounting.create_fixed_asset', 'tax.close_period']) {
      expect(suggestionsForToolCall(name).length).toBeLessThanOrEqual(3);
    }
  });
});
