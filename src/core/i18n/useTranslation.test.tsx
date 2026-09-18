import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTranslation } from './useTranslation';

function Probe({ k, params }: { k: string; params?: Record<string, string | number> }) {
  const { t } = useTranslation();
  return <span>{t(k, params)}</span>;
}

describe('useTranslation default fallback (Phase 6)', () => {
  it('renders the inline default instead of the raw key when missing', () => {
    render(<Probe k="pos.no.such.key" params={{ default: 'نص بديل' }} />);
    expect(screen.getByText('نص بديل')).toBeInTheDocument();
  });

  it('still returns the raw key when missing without a default', () => {
    render(<Probe k="pos.no.such.key" />);
    expect(screen.getByText('pos.no.such.key')).toBeInTheDocument();
  });

  it('prefers the real translation over the default', () => {
    render(<Probe k="cancel" params={{ default: 'X' }} />);
    expect(screen.queryByText('X')).not.toBeInTheDocument();
  });
});
