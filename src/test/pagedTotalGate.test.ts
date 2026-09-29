/**
 * A paged read must report the true total even when the requested page is past
 * the end of the data.
 *
 * The renderer bodies run a COUNT and a page query as two statements, so their
 * total is always known. COUNT(*) OVER() cannot reproduce that: an empty page
 * returns no rows, and the total goes with the first row it was attached to. The
 * renderer then reads 0 and the screen collapses to "no results" - while the
 * PGlite path, which runs a separate COUNT, shows the remaining pages. Same
 * screen, two behaviours, depending on whether the app runs in Electron.
 *
 * The fix is count LEFT JOIN LATERAL page ON true, which always emits one row
 * carrying the total, plus has_row to tell an empty page from a real row.
 * pos.getProducts already worked that way, so there was a precedent in the tree.
 *
 * This gate pins the exact SET, not a count, for two reasons learned the hard
 * way here. A count alone is what produced two wrong published numbers in this
 * area: a first scan that crossed registerRpc boundaries and matched ten
 * channels it should not have, then a second that demanded the literal
 * "COUNT(*) OVER() AS total_count" and so missed every channel writing
 * "(COUNT(*) OVER())::int" - undercounting to ten when it was nineteen. A pinned
 * set makes both mistakes impossible: a name that appears or disappears fails
 * loudly instead of shifting a total.
 *
 * The list is expected to shrink to empty as the modules are ported. Every
 * removal has to be a deliberate edit here, which is the point: the day the last
 * one goes, the gate starts failing on a channel nobody remembered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dbHandlerSrc = readFileSync(resolve(__dirname, '../../electron/dbHandler.js'), 'utf8');

/** Every registerRpc block, bounded by its own object literal, quotes and templates skipped. */
function readChannels(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /registerRpc\('([\w.]+)',\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dbHandlerSrc))) {
    const objStart = dbHandlerSrc.indexOf('{', m.index);
    let depth = 0;
    let end = -1;
    for (let i = objStart; i < dbHandlerSrc.length; i++) {
      const c = dbHandlerSrc[i];
      if (c === '\\') { i++; continue; }
      if (c === '`') { const e = dbHandlerSrc.indexOf('`', i + 1); if (e > 0) i = e; continue; }
      if (c === "'") { const e = dbHandlerSrc.indexOf("'", i + 1); if (e > 0) i = e; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    out.push({ name: m[1], body: dbHandlerSrc.slice(objStart, end + 1) });
  }
  return out;
}

const channels = readChannels();
const usesWindowCount = channels.filter((c) => /COUNT\(\s*\*\s*\)\s*OVER/i.test(c.body)).map((c) => c.name).sort();
const usesLateral = channels.filter((c) => /LEFT JOIN LATERAL/i.test(c.body)).map((c) => c.name).sort();

/** Channels still reporting a total through a window function. Shrinks to []. */
const STILL_DEFECTIVE = [
  'pos.getShiftsPaginated',
  'purchases.getInvoicesPaginated',
  'purchases.getOrdersPaginated',
  'purchases.getReturnsPaginated',
  'purchases.getSuppliersPaginated',
  'sales.getCustomersPaginated',
  'sales.getInvoicesPaginated',
  'sales.getQuotationsPaginated',
  'sales.getReturnsPaginated',
];

describe('a paged read knows its total even when the page is empty', () => {
  it('finds the channels - the scan has to see something', () => {
    // Without this, a broken parse would make every assertion below pass by
    // comparing two empty lists.
    expect(channels.length).toBeGreaterThan(150);
  });

  it('pins the exact set of channels whose total dies on an empty page', () => {
    expect(usesWindowCount).toEqual(STILL_DEFECTIVE);
  });

  it('accepts any spelling of the window count', () => {
    // The spelling varies: bare COUNT(*) OVER(), and the (COUNT(*) OVER())::int
    // form several modules use. Missing one is how the ten-versus-nineteen
    // undercount happened.
    for (const c of channels) {
      const anyWindowCount = /OVER\s*\(\s*\)/i.test(c.body) && /COUNT\s*\(/i.test(c.body);
      if (!anyWindowCount) continue;
      expect(
        STILL_DEFECTIVE.includes(c.name),
        `${c.name} reports a total via a window count but is not in STILL_DEFECTIVE; add it deliberately or port it to LEFT JOIN LATERAL`,
      ).toBe(true);
    }
  });

  it('has no channel mixing both approaches', () => {
    const both = channels
      .filter((c) => /COUNT\(\s*\*\s*\)\s*OVER/i.test(c.body) && /LEFT JOIN LATERAL/i.test(c.body))
      .map((c) => c.name);
    expect(both).toEqual([]);
  });

  it('every lateral channel that reports a total exposes has_row', () => {
    // Not every LATERAL is this pattern. pos.getProducts uses one to gather
    // category_ids per product row and reports no total at all, so demanding
    // has_row of every lateral channel would be the gate being wrong rather
    // than the code. The rule belongs to the ones that carry a total.
    const totals = usesLateral.filter((name) => {
      const ch = channels.find((c) => c.name === name);
      return ch ? /total_count/i.test(ch.body) : false;
    });
    expect(totals.length).toBeGreaterThan(0);
    for (const name of totals) {
      const ch = channels.find((c) => c.name === name);
      expect(ch, `${name} has LEFT JOIN LATERAL`).toBeTruthy();
      expect(ch!.body, `${name} must emit has_row`).toMatch(/has_row/i);
    }
  });

  it('a lateral channel without a total is not one of ours', () => {
    // Guards the distinction above: if a future channel reports a total through
    // some other construct, this names it rather than letting the rule above
    // pass on the strength of an unrelated LATERAL.
    const nonTotalLateral = usesLateral.filter((name) => {
      const ch = channels.find((c) => c.name === name);
      return ch ? !/total_count/i.test(ch.body) : false;
    });
    expect(nonTotalLateral).toEqual(['pos.getProducts']);
  });

  it('records what a correct port looks like', () => {
    // Reverse proof that the detector works on the shape it claims to police.
    const good = channels.find((c) => c.name === 'accounting.getTransactionsPaginated');
    expect(good, 'the reference port still exists').toBeTruthy();
    expect(good!.body).toMatch(/LEFT JOIN LATERAL/i);
    expect(good!.body).toMatch(/has_row/i);
    expect(good!.body).not.toMatch(/COUNT\(\s*\*\s*\)\s*OVER/i);
  });
});
