import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readDocumentDraft } from './useDocumentDraft';

describe('document draft storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null for a missing draft', () => {
    expect(readDocumentDraft('missing-doc')).toBeNull();
  });

  it('round-trips a saved payload', () => {
    localStorage.setItem('maghzaccount-draft-sales-invoice', JSON.stringify({ customerId: 'c1', lines: [{ productId: 'p1' }] }));
    const saved = readDocumentDraft<{ customerId: string; lines: Array<{ productId: string }> }>('sales-invoice');
    expect(saved?.customerId).toBe('c1');
    expect(saved?.lines?.[0]?.productId).toBe('p1');
  });

  it('ignores malformed JSON instead of throwing', () => {
    localStorage.setItem('maghzaccount-draft-broken', '{not-json');
    expect(readDocumentDraft('broken')).toBeNull();
  });

  it('keys drafts per document type', () => {
    localStorage.setItem('maghzaccount-draft-a', JSON.stringify({ v: 1 }));
    localStorage.setItem('maghzaccount-draft-b', JSON.stringify({ v: 2 }));
    expect(readDocumentDraft<{ v: number }>('a')?.v).toBe(1);
    expect(readDocumentDraft<{ v: number }>('b')?.v).toBe(2);
  });
});
