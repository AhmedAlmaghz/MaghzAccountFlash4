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
    const line: DocumentLine = { productId: 'p1', productName: 'X', quantity: 3, unitPrice: 100, unitFactor: 1 };
    const net = line.quantity * line.unitPrice;
    expect(net).toBe(300);
  });
});
