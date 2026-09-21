import { test, expect } from '@playwright/test';

/**
 * Worker-transport live-boot probe (migration step 3 gate).
 *
 * Boots a REAL PGlite inside a dedicated Worker in a real Chromium tab and
 * proves the two properties the whole migration exists for:
 *   1. The engine answers SQL off-thread (version + heavy aggregation).
 *   2. The UI thread stays alive WHILE the heavy query runs (rAF ticks keep
 *      advancing — on the main-thread transport the same query freezes them).
 *
 * Deliberately bypasses the app shell (`/__e2e/ping` boots no app code, so
 * the main-thread engine never takes the IndexedDB lock) and the adapter
 * flag (direct WorkerTransport import — no seeded data needed).
 */
test.describe('PGlite worker transport (live boot)', () => {
  test('boots off-thread and answers SQL while the page stays responsive', async ({ page }) => {
    // Same-origin page with zero app boot: no main-thread engine, no lock fight.
    await page.goto('/__e2e/ping');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/core/database/adapters/pgliteWorkerTransport.ts');
      const t = mod.createWorkerTransport(120_000);

      const v = await t.queryRaw('SELECT version() AS version');

      // Responsiveness probe: rAF ticks must keep advancing DURING the heavy
      // query. A main-thread engine would freeze them for the whole run.
      let ticks = 0;
      let stop = false;
      const tick = (): void => {
        if (!stop) {
          ticks++;
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
      const h = await t.queryRaw('SELECT COUNT(*) AS n FROM generate_series(1, 3000000)');
      stop = true;

      return {
        version: (v.rows[0] as { version?: unknown } | undefined)?.version ?? null,
        count: (h.rows[0] as { n?: unknown } | undefined)?.n,
        ticks,
      };
    });

    expect(String(result.version)).toContain('PostgreSQL');
    expect(Number(result.count)).toBe(3_000_000);
    // Any double-digit tick count proves the UI thread lived through the query.
    expect(result.ticks).toBeGreaterThan(10);
  });
});
