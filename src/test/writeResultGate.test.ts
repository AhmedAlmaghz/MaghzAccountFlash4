import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A write whose result is dropped is a silent divergence.
 *
 * `await adapter.query('UPDATE …')` without inspecting the result means the
 * caller is told the outcome of some OTHER statement, or of nothing at all.
 * The failures this produced were all financial: a payroll run committed its
 * header alone (and then occupied the period, so the next run for that month
 * was rejected), a BOM kept an edited header over deleted materials, a product
 * lost every category during a "failed" price edit, a work order reopened with
 * the previous run's actual quantities still on its consumption rows.
 *
 * Rule: every raw write statement must be either
 *   - bound to a variable / returned / guarded, or
 *   - part of an `adapter.transaction([...])` batch whose result is inspected.
 *
 * Parsing note: method bodies are located by the file's own line shape
 * (2-space `  async name(` … `  },`), which survives strings and regex
 * literals where brace counting does not; control flow at the same indent is
 * excluded by name so a body is never truncated.
 */
const SRC = join(process.cwd(), 'src', 'modules');
const RESERVED = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'return', 'with']);

const WRITE = /(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)/i;
/** The call forms that reach the database outside a transaction batch. */
const CALL = /(await\s+(?:adapter\.query|adapter\._exec|invoke[A-Za-z]*Rpc)\s*\()/;

function apiFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      apiFiles(full, out);
    } else if (entry === 'api.ts') {
      out.push(full);
    }
  }
  return out;
}

function methodBodies(absPath: string): Array<{ key: string; body: string }> {
  const rel = absPath.replace(process.cwd() + '\\', '').replace(/\\/g, '/');
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  const bodies: Array<{ key: string; body: string }> = [];
  let name: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (name) bodies.push({ key: `${rel}:${name}`, body: buf.join('\n') });
    name = null;
    buf = [];
  };
  for (const line of lines) {
    const open = /^ {2}(?:async )?([A-Za-z0-9_]+)\s*\(/.exec(line);
    if (open && !RESERVED.has(open[1])) {
      if (name) flush();
      name = open[1];
      buf = [line];
      continue;
    }
    if (name) {
      if (/^ {2}\},?\s*$/.test(line) || /^ {2}\}\);?\s*$/.test(line)) flush();
      else buf.push(line);
    }
  }
  flush();
  return bodies;
}

interface Finding { key: string; line: number; sql: string }

const findings: Finding[] = [];
let seenWrites = 0;

for (const b of apiFiles(SRC).flatMap(methodBodies)) {
  const lines = b.body.split('\n');
  lines.forEach((line, i) => {
    const call = CALL.exec(line);
    if (!call) return;
    if (/tx\.push\(|statements\.push\(|\|\|/.test(line)) return;
    const chunk = lines.slice(i, i + 7).join(' ');
    const lit = /`([^`]*)`|'([^']*)'|"([^"]*)"/.exec(chunk);
    const sql = (lit ? (lit[1] ?? lit[2] ?? lit[3]) : chunk).replace(/\s+/g, ' ');
    if (!WRITE.test(sql)) return;
    // Counted before the ownership checks: this is the scanner's reach, and it
    // is what proves the assertions below are not passing on an empty parse.
    seenWrites++;
    // bound to a variable, returned, or guarded → the caller inspects it
    const prefix = line.slice(0, call.index);
    if (/(?:=|return|if\s*\(|!|\?|&&|\|\|)\s*$/.test(prefix) || /^\s*(const|let|var)\b/.test(prefix)) return;
    findings.push({ key: b.key, line: i, sql: sql.slice(0, 80) });
  });
}

describe('raw write results are never dropped', () => {
  it('the scanner actually reaches the write statements (no blind spot)', () => {
    // Guards against a parser regression silently passing everything.
    expect(seenWrites).toBeGreaterThan(40);
  });

  it('no raw write is fire-and-forget', () => {
    const report = findings.map((f) => `${f.key} — ${f.sql}`).join('\n');
    expect(report).toBe('');
  });
});
