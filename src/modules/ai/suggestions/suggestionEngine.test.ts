import { describe, it, expect } from 'vitest';
import {
  extractSuggestions,
  suggestionsForToolCall,
  suggestionsForText,
} from './suggestionEngine';
import type { ChatMessage, PendingToolCall } from '../types';

function makeMsg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    kind: 'text',
    content: '',
    createdAt: 0,
    ...partial,
  };
}

function makeToolCall(name: string, status: PendingToolCall['status'] = 'success'): PendingToolCall {
  return {
    callId: 'c1',
    toolName: name,
    label: name,
    args: {},
    status,
    dangerLevel: 'read',
  };
}

describe('suggestionEngine', () => {
  it('returns nothing for user messages', () => {
    const msg = makeMsg({ role: 'user', content: 'مرحبا' });
    expect(extractSuggestions(msg)).toEqual([]);
  });

  it('maps a successful create_invoice to a PROACTIVE next-step chip first (post it)', () => {
    const msg = makeMsg({ toolCall: makeToolCall('sales.create_invoice') });
    const suggestions = extractSuggestions(msg);
    // next-step + navigate + create-another, capped at 3
    expect(suggestions.length).toBe(3);
    expect(suggestions[0]).toMatchObject({
      type: 'prompt',
      promptKey: 'ai.actions.postLatestInvoice',
    });
    expect(suggestions[1]).toMatchObject({ type: 'navigate', path: '/sales/invoices' });
    expect(suggestions[2]).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.createAnother' });
  });

  it('maps a write tool for customers to the customers page (next-step first)', () => {
    const suggestions = suggestionsForToolCall('sales.create_customer');
    expect(suggestions[0]).toMatchObject({ promptKey: 'ai.actions.invoiceLatestCustomer' });
    expect(suggestions[1]).toMatchObject({ path: '/sales/customers', labelKey: 'ai.actions.openCustomers' });
  });

  it('maps a read tool to navigate + compare chip (unchanged by next-step work)', () => {
    const [nav, compare] = suggestionsForToolCall('read.profit_loss');
    expect(nav).toMatchObject({ type: 'navigate', path: '/accounting/profit' });
    expect(compare).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.comparePrevious' });
  });

  it('falls back to module-level page for unrecognized module tools', () => {
    const [s] = suggestionsForToolCall('hr.get_attendance');
    expect(s).toMatchObject({ path: '/hr/employees', labelKey: 'ai.actions.openEmployees' });
  });

  it('derives navigation suggestions from Arabic assistant text', () => {
    const suggestions = suggestionsForText('ميزان المراجعة يظهر توازناً');
    expect(suggestions.some((s) => s.path === '/accounting/trial')).toBe(true);
  });

  it('derives navigation suggestions from English assistant text', () => {
    const suggestions = suggestionsForText('Your trial balance is balanced');
    expect(suggestions.some((s) => s.path === '/accounting/trial')).toBe(true);
  });

  it('extracts keyword suggestions from plain assistant text', () => {
    const msg = makeMsg({ content: 'فواتير المبيعات هذا الشهر مرتفعة' });
    const suggestions = extractSuggestions(msg);
    expect(suggestions.some((s) => s.path === '/sales/invoices')).toBe(true);
  });

  it('returns empty for assistant text with no known keywords', () => {
    const msg = makeMsg({ content: 'أهلاً بك! كيف يمكنني المساعدة؟' });
    expect(extractSuggestions(msg)).toEqual([]);
  });

  it('does not suggest for non-success tool calls', () => {
    const msg = makeMsg({ toolCall: makeToolCall('sales.create_invoice', 'error') });
    expect(extractSuggestions(msg)).toEqual([]);
  });

  it('treats convert_ tools as write tools (follow-up chip after nav)', () => {
    const suggestions = suggestionsForToolCall('crm.convert_lead_to_customer');
    expect(suggestions[0]).toMatchObject({ promptKey: 'ai.actions.followUpConvertedCustomer' });
    expect(suggestions[1]).toMatchObject({ path: '/crm/leads' });
  });

  it('win_opportunity proposes invoicing the won deal (rule 34 chip)', () => {
    const suggestions = suggestionsForToolCall('crm.win_opportunity');
    expect(suggestions[0]).toMatchObject({ promptKey: 'ai.actions.quoteWonOpportunity' });
  });

  it('verb-level fallback: post_* tools get a show-posting chip', () => {
    const suggestions = suggestionsForToolCall('accounting.post_journal_entry');
    expect(suggestions[0]).toMatchObject({ promptKey: 'ai.actions.showLatestPosting' });
  });

  it('verb-level fallback: unknown create_* tools get a summarize chip', () => {
    const suggestions = suggestionsForToolCall('crm.create_activity');
    expect(suggestions[0]).toMatchObject({ promptKey: 'ai.actions.summarizeLatestDocument' });
  });

  it('never exceeds 3 chips so the next-step chip stays visible', () => {
    for (const name of [
      'sales.create_invoice', 'sales.create_and_post_invoice', 'purchases.create_invoice',
      'hr.generate_payroll_run', 'manufacturing.create_work_order', 'crm.win_opportunity',
    ]) {
      expect(suggestionsForToolCall(name).length).toBeLessThanOrEqual(3);
    }
  });
});
