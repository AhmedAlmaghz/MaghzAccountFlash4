import { describe, it, expect } from 'vitest';
import { isOpeningRow } from './statementWithOpening';

describe('statementWithOpening utilities', () => {
  it('isOpeningRow detects the opening row by document type (camelCase)', () => {
    expect(isOpeningRow({ documentType: 'رصيد افتتاحي' })).toBe(true);
  });

  it('isOpeningRow detects the opening row by document type (snake_case)', () => {
    expect(isOpeningRow({ document_type: 'رصيد افتتاحي' })).toBe(true);
  });

  it('isOpeningRow detects OPENING / English labels', () => {
    expect(isOpeningRow({ documentType: 'OPENING' })).toBe(true);
    expect(isOpeningRow({ documentType: 'Opening' })).toBe(true);
  });

  it('isOpeningRow rejects regular movement rows', () => {
    expect(isOpeningRow({ documentType: 'فاتورة' })).toBe(false);
    expect(isOpeningRow({ documentType: 'سند قبض' })).toBe(false);
    expect(isOpeningRow({})).toBe(false);
  });
});
