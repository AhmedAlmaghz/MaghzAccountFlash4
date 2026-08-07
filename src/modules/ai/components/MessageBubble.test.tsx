import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useAppStore } from '@/core/store';
import type { ChatMessage, PendingToolCall } from '../types';
import type { Suggestion } from '../suggestions/suggestionEngine';

function makeMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    kind: 'text',
    content: 'تم إنجاز العملية',
    createdAt: 0,
    ...partial,
  };
}

function makeSuggestion(id: string, type: Suggestion['type']): Suggestion {
  return {
    id,
    type,
    labelKey: 'ai.suggestions.invoice',
    ...(type === 'navigate' ? { path: '/sales/invoices' } : { promptKey: 'ai.actions.createAnother' }),
  };
}

describe('MessageBubble suggestion chips', () => {
  beforeEach(() => {
    useAppStore.setState({ language: 'ar' });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders suggestion chips for the assistant message', () => {
    const suggestions = [makeSuggestion('nav-1', 'navigate'), makeSuggestion('prompt-1', 'prompt')];
    render(<MessageBubble message={makeMessage({})} suggestions={suggestions} />);
    // labelKey ai.suggestions.invoice = "أنشئ فاتورة مبيعات جديدة"
    expect(screen.getAllByText('أنشئ فاتورة مبيعات جديدة')).toHaveLength(2);
  });

  it('calls onSuggestion with the clicked suggestion', () => {
    const onSuggestion = vi.fn();
    const suggestions = [makeSuggestion('nav-1', 'navigate')];
    render(
      <MessageBubble
        message={makeMessage({})}
        suggestions={suggestions}
        onSuggestion={onSuggestion}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: /أنشئ فاتورة مبيعات جديدة/ })[0]);
    expect(onSuggestion).toHaveBeenCalledWith(suggestions[0]);
  });

  it('does not render chips for user messages', () => {
    const suggestions = [makeSuggestion('nav-1', 'navigate')];
    render(<MessageBubble message={makeMessage({ role: 'user', content: 'مرحبا' })} suggestions={suggestions} />);
    expect(screen.queryByRole('button', { name: /أنشئ فاتورة مبيعات جديدة/ })).not.toBeInTheDocument();
  });

  it('renders tool call card for a tool message', () => {
    const toolCall: PendingToolCall = {
      callId: 'c1',
      toolName: 'sales.create_invoice',
      label: 'sales.create_invoice',
      args: {},
      status: 'success',
      dangerLevel: 'read',
    };
    render(<MessageBubble message={makeMessage({ toolCall, content: '' })} />);
    expect(screen.getByText('sales.create_invoice')).toBeInTheDocument();
  });

  it('does not render chips when the array is empty', () => {
    render(<MessageBubble message={makeMessage({})} suggestions={[]} />);
    expect(screen.queryByRole('button', { name: /أنشئ فاتورة مبيعات جديدة/ })).not.toBeInTheDocument();
  });
});
