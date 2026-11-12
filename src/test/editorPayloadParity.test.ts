import { describe, it, expect } from 'vitest';
import { findEditorPayloadProblems } from './editorPayloadCheck';

/**
 * Parity gate for the document editors' create payloads.
 *
 * The API validates a create payload EXACTLY as it arrives — it never
 * injects the tenant and never generates a document number. Every
 * create*Schema therefore requires `companyId` plus the document number.
 *
 * The full-page editors (phase 104) dropped both, so EVERY save failed
 * validation silently: no request was made, and the error the user saw
 * named a field they never touched. This gate keeps payload and schema in
 * sync (the shared checker lives in src/test/editorPayloadCheck.ts so the
 * CLI and the gate can never drift apart).
 */
describe('document editor payloads satisfy their create schema', () => {
  it('no editor payload misses a required schema field', () => {
    expect(findEditorPayloadProblems()).toEqual([]);
  });
});
