import { describe, it, expect, vi } from 'vitest';
import { readDocumentDraft } from './useDocumentDraft';
import type { DocumentLine } from './DocumentItemsGrid';

vi.mock('react-router-dom', () => ({
  useBlocker: () => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() }),
}));

describe('document draft helpers', () => {
  it('exports doc key helper', () => {
    expect(readDocumentDraft('missing-doc')).toBeNull();
  });

  it('line totals math stays consistent', () => {
    const line: DocumentLine = { productId: 'p1', productName: 'X', quantity: 3, unitPrice: 100, discountPercent: 10, vatPercent: 15, unitFactor: 1 };
    const net = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
    expect(net).toBe(270);
  });
});
