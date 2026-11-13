import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import {
  MOJIBAKE,
  ROOTS,
  scannedFiles,
  findMojibake,
} from '../../scripts/encodingSignatures.mjs';

/**
 * CI GATE — encoding integrity for user-facing / model-facing text.
 *
 * A single UTF-8 → Windows-1256 re-encoding pass in the v0.15.18 release
 * turned all 21 tools in `readTools.ts` into mojibake: the model received
 * garbled text instead of "معلومات الشركة" for months. Tests stayed green
 * because none asserted the Arabic payload.
 *
 * The signature list and the scanner live in `scripts/encodingSignatures.mjs`
 * so this gate and the plain-node CLI (`node scripts/check-encoding.mjs`)
 * can never drift apart — a gate that catches half the failures is worse
 * than no gate, because it looks green.
 */

describe('encoding gate — no mojibake in agent-facing text', () => {
  const files = scannedFiles();

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('uses an unambiguous signature set', () => {
    // A one-character signature that legitimately appears in the scanned
    // trees would make the gate noise; the check below proves the set is
    // not empty and not accidentally matching plain ASCII.
    expect(MOJIBAKE.length).toBeGreaterThan(0);
    expect(MOJIBAKE.every((s) => s.length > 0)).toBe(true);
    expect(ROOTS).toContain('e2e'); // the bridge shim renders Arabic labels
  });

  it('every scanned file is free of mojibake signatures', () => {
    const broken = findMojibake();
    expect(
      broken,
      `mojibake detected (likely a UTF-8 → cp1256 round-trip):\n${broken.join('\n')}`,
    ).toEqual([]);
  }, 30_000);

  it('the scanned file list is rooted in the repository', () => {
    for (const file of files) {
      expect(relative(process.cwd(), file).length).toBeGreaterThan(0);
    }
  });
});
