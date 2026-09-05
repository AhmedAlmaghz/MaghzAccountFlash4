import { describe, it, expect, beforeEach } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition } from '../types';
import type { User } from '@/modules/auth/types';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    labelAr: 'أداة',
    descriptionAr: `وصف ${name}`,
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({}),
  };
}

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('includes company name from app store', () => {
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'شركة الاختبار', currency: 'YER' },
    });
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('شركة الاختبار');
  });

  it('includes default currency', () => {
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'شركة', currency: 'USD' },
    });
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('USD');
  });

  it('includes user name and role', () => {
    const user: User = {
      id: '1',
      username: 'ahmed',
      email: 'a@b.com',
      role: 'accountant',
      isActive: true,
      fullName: 'أحمد محمد',
    };
    useAuthStore.getState().login(user);
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('أحمد محمد');
    expect(prompt).toContain('accountant');
  });

  it('lists tool names grouped by domain without duplicating descriptions', () => {
    // Descriptions travel in the request's `tools` parameter — repeating them
    // in the prompt wastes thousands of tokens per request (slower TTFT).
    const tools = [makeTool('sales.get_invoices'), makeTool('inventory.get_products')];
    const prompt = buildSystemPrompt({ tools });
    expect(prompt).toContain('sales.get_invoices');
    expect(prompt).toContain('inventory.get_products');
    expect(prompt).toContain('- sales: sales.get_invoices');
    expect(prompt).not.toContain('وصف sales.get_invoices');
  });

  it('includes today date in LOCAL ISO format (never the UTC day)', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    // The prompt must carry the LOCAL calendar day — the UTC day can be
    // yesterday for GMT+3 users between 00:00 and 03:00 (Phase 76 rule).
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(prompt).toContain(local);
  });

  it('contains the strict rules section', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('قواعد صارمة');
    expect(prompt).toContain('لا تخترع أرقاماً');
    expect(prompt).toContain('لا تفترض أسعاراً');
  });

  it('contains the terminology glossary', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('مصطلحات النظام');
    expect(prompt).toContain('سند قبض');
    expect(prompt).toContain('BOM');
  });

  it('contains the response style guide', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('أسلوب الرد');
    expect(prompt).toContain('كن موجزاً');
    expect(prompt).toContain('رمز العملة');
  });

  it('contains the tool usage guide with examples', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('كيفية استخدام الأدوات');
    expect(prompt).toContain('search.customers');
    expect(prompt).toContain('sales.create_invoice');
  });

  it('mentions multi-step workflow pattern', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('سير عمل كامل');
    expect(prompt).toContain('محمد الأحمدي');
  });

  it('forbids retrying failed tools with same arguments', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('لا تكرر نفس الأداة');
  });

  it('forbids imitating the internal tool-result format in replies', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('[تم تنفيذ: ...]');
    expect(prompt).toContain('[TOOL_RESULT: ...]');
    expect(prompt).toContain('لا تدّعِ أبداً أن أداة نُفِّذت');
  });

  it('shows tool count in prompt', () => {
    const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
    const prompt = buildSystemPrompt({ tools });
    expect(prompt).toContain('(3 أداة)');
  });

  it('handles missing company gracefully', () => {
    useAppStore.setState({ activeCompany: null });
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('غير محددة');
    expect(prompt).toContain('YER');
  });

  // ── Live financial context (المرحلة ج) ────────────────────────────────────

  it('renders the ACTUAL company VAT rate when liveContext is provided', () => {
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    const prompt = buildSystemPrompt({ tools: [], liveContext: { vatRate: 5 } });
    expect(prompt).toContain('5%');
    expect(prompt).not.toContain('لا تفترض 15%');
  });

  it('instructs the model to ASK about VAT when liveContext lacks it (no 15% assumption)', () => {
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('لا تفترض 15%');
  });

  it('tells the model VAT is off when the company disabled it on invoices', () => {
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    const prompt = buildSystemPrompt({ tools: [], liveContext: { vatRate: 0, vatOnInvoices: false } });
    expect(prompt).toContain('invoice.showVat');
    expect(prompt).toContain('بدون ضريبة');
  });

  it('keeps the rate line when VAT display is on', () => {
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    const prompt = buildSystemPrompt({ tools: [], liveContext: { vatRate: 5, vatOnInvoices: true } });
    expect(prompt).toContain('5%');
  });

  it('states the fiscal year start and interprets "السنة" by it', () => {
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'شركة', currency: 'YER', fiscalYearStart: '2026-04-01' },
    });
    const prompt = buildSystemPrompt({ tools: [] });
    expect(prompt).toContain('2026-04-01');
    expect(prompt).toContain('بداية السنة المالية');
  });

  it('notes hijri support for hijri-calendar companies and in general', () => {
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'شركة', currency: 'YER', calendar: 'hijri' },
    });
    const hijriPrompt = buildSystemPrompt({ tools: [] });
    expect(hijriPrompt).toContain('هجري');
    expect(hijriPrompt).toContain('15 محرم 1448');

    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    const gregPrompt = buildSystemPrompt({ tools: [] });
    expect(gregPrompt).toContain('ميلادي');
    expect(gregPrompt).toContain('التواريخ الهجرية');
  });
});
