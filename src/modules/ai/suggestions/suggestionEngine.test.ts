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

  it('maps a successful write tool to a navigate + create-another chip', () => {
    const msg = makeMsg({ toolCall: makeToolCall('sales.create_invoice') });
    const suggestions = extractSuggestions(msg);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0]).toMatchObject({ type: 'navigate', path: '/sales/invoices' });
    expect(suggestions[1]).toMatchObject({ type: 'prompt', promptKey: 'ai.actions.createAnother' });
  });

  it('maps a write tool for customers to the customers page', () => {
    const msg = makeMsg({ toolCall: makeToolCall('sales.create_customer') });
    const [s] = suggestionsForToolCall('sales.create_customer');
    expect(s.path).toBe('/sales/customers');
    expect(s.labelKey).toBe('ai.actions.openCustomers');
    void msg;
  });

  it('maps a read tool to navigate + compare chip', () => {
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

  it('treats convert_ tools as write tools', () => {
    const [s] = suggestionsForToolCall('crm.convert_lead_to_customer');
    expect(s).toMatchObject({ path: '/crm/leads' });
    expect(suggestionsForToolCall('crm.convert_lead_to_customer')[1]).toMatchObject({
      type: 'prompt',
    });
  });
});
