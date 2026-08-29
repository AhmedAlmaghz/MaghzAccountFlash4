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

  it('includes today date in ISO format', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    const today = new Date().toISOString().split('T')[0];
    expect(prompt).toContain(today);
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
});
