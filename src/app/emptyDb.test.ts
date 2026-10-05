import { describe, it, expect } from 'vitest';
import { isEmptyDatabaseResult } from './emptyDb';

describe('isEmptyDatabaseResult (empty-DB recovery gate)', () => {
  it('matches the exact envelope every adapter returns for a company-less DB', () => {
    expect(isEmptyDatabaseResult({ success: false, error: 'No company found' })).toBe(true);
  });

  it('is case-insensitive (adapters must stay free to reword)', () => {
    expect(isEmptyDatabaseResult({ success: false, error: 'no company found' })).toBe(true);
  });

  it('does not fire on success, even with data present', () => {
    expect(isEmptyDatabaseResult({ success: true })).toBe(false);
    expect(isEmptyDatabaseResult({ success: true, error: 'No company found' })).toBe(false);
  });

  it('does not fire on other failures (network/auth) — those keep the error screen', () => {
    expect(isEmptyDatabaseResult({ success: false, error: 'timeout' })).toBe(false);
    expect(isEmptyDatabaseResult({ success: false, error: 'Authentication required' })).toBe(false);
    expect(isEmptyDatabaseResult({ success: false })).toBe(false);
    expect(isEmptyDatabaseResult(null)).toBe(false);
    expect(isEmptyDatabaseResult(undefined)).toBe(false);
  });
});
