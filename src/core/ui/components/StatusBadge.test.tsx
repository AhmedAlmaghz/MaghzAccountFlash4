import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('StatusBadge', () => {
  it('renders a known status with translated text', () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByText('status.draft')).toBeInTheDocument();
  });

  it('renders fallback text for unknown status', () => {
    render(<StatusBadge status="unknown_status" />);
    expect(screen.getByText('unknown_status')).toBeInTheDocument();
  });

  it('renders with sm size by default', () => {
    const { container } = render(<StatusBadge status="posted" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('text-xs');
  });

  it('renders with md size', () => {
    const { container } = render(<StatusBadge status="posted" size="md" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('text-sm');
  });

  it('applies custom className', () => {
    const { container } = render(<StatusBadge status="draft" className="custom-class" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('custom-class');
  });

  it.each([
    ['draft', 'status.draft'],
    ['posted', 'status.posted'],
    ['paid', 'status.paid'],
    ['partially_paid', 'status.partiallyPaid'],
    ['cancelled', 'status.cancelled'],
    ['active', 'status.active'],
    ['inactive', 'status.inactive'],
    ['pending', 'status.pending'],
    ['completed', 'status.completed'],
    ['rejected', 'status.rejected'],
    ['approved', 'status.approved'],
    ['open', 'status.open'],
    ['closed', 'status.closed'],
    ['new', 'status.new'],
    ['contacted', 'status.contacted'],
    ['qualified', 'status.qualified'],
    ['converted', 'status.converted'],
    ['lost', 'status.lost'],
    ['won', 'status.won'],
  ])('translates status "%s" to key "%s"', (status, expectedKey) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(expectedKey)).toBeInTheDocument();
  });

  it('maps cancelled_mfg to cancelled translation', () => {
    render(<StatusBadge status="cancelled_mfg" />);
    expect(screen.getByText('status.cancelled')).toBeInTheDocument();
  });
});
