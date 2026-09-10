import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCard } from './ToolCallCard';
import { useAppStore } from '@/core/store';
import type { PendingToolCall } from '../types';

function makeCall(over: Partial<PendingToolCall> = {}): PendingToolCall {
  return {
    callId: 'c1',
    toolName: 'sales.create_invoice',
    label: 'إنشاء فاتورة مبيعات',
    args: { customerId: 'cust-1' },
    status: 'pending-confirmation',
    argsSummary: 'إنشاء فاتورة — 3 أصناف — الإجمالي ≈ 172,500 ر.ي',
    ...over,
  };
}

describe('ToolCallCard (Stage-3 component gate)', () => {
  beforeEach(() => {
    useAppStore.setState({ language: 'ar' });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('always shows the approval substance without expanding (no blind approval)', () => {
    render(<ToolCallCard toolCall={makeCall()} />);
    expect(screen.getByText(/3 أصناف/)).toBeInTheDocument();
  });

  it('approve/reject buttons call onConfirm with the right verdict', () => {
    const onConfirm = vi.fn();
    render(<ToolCallCard toolCall={makeCall()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /موافقة|تأكيد|اعتماد/i }));
    expect(onConfirm).toHaveBeenCalledWith('c1', true);
    fireEvent.click(screen.getByRole('button', { name: /رفض/i }));
    expect(onConfirm).toHaveBeenCalledWith('c1', false);
  });

  it('hides confirmation buttons when not pending', () => {
    render(<ToolCallCard toolCall={makeCall({ status: 'success' })} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /موافقة|تأكيد|اعتماد/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /رفض/i })).not.toBeInTheDocument();
  });

  it('expand reveals tool name and raw args', () => {
    render(<ToolCallCard toolCall={makeCall()} />);
    expect(screen.queryByText('sales.create_invoice')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /التفاصيل|عرض|إظهار/i });
    fireEvent.click(toggle);
    expect(screen.getByText('sales.create_invoice')).toBeInTheDocument();
    expect(screen.getByText(/cust-1/)).toBeInTheDocument();
  });

  it('renders result summary for finished calls', () => {
    render(
      <ToolCallCard
        toolCall={makeCall({ status: 'success', resultSummary: 'تم إنشاء الفاتورة INV-0001' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /التفاصيل|عرض|إظهار/i }));
    expect(screen.getByText(/INV-0001/)).toBeInTheDocument();
  });
});
