// Standalone schema-sync CLI: heals whatever database .env.local points to.
// Usage: npm run db:sync   (or)   node --env-file=.env.local scripts/db-sync.mjs
import { runDrizzleMigrations } from '../electron/migrationRunner.js';

try {
  await runDrizzleMigrations();
  console.log('[db:sync] Done.');
  process.exit(0);
} catch (e) {
  console.error('[db:sync] FAILED:', e.message);
  process.exit(1);
}
