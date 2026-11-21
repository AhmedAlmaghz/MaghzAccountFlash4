const fs = require('fs');
const { execSync } = require('child_process');
const cwd = 'E:\\MaghzAccountApp\\MaghzAccountFlash35';

fs.writeFileSync('commit-msg.txt', [
  'fix(backup,onboarding): plan sessions table + existing-database mode (Phase 105b)',
  '',
  '- backupTables/dbHandler: add `sessions` (drizzle/0003_sessions) to BACKUP_PLAN,',
  '  BACKUP_INSERT_ORDER, USER_REF_COLUMNS/RESTORE_USER_REF_COLUMNS (parity) — was missing:',
  '  backupTables.test.ts "covers every live table" was red',
  '- dev DB: apply pending migrations (0003-0006) via runDrizzleMigrations(); backup read now covers 70 tables',
  '- onboarding: new mode "connect to existing database (no seed)" — SeedOption \'existing\',',
  '  DatabaseStep card, SeedStep checkDatabaseHasData() + gated Next, handleFinish early-exit → login',
  '- electron: sessionless db:has-users (dbHandler + preload.cjs/js + ElectronDB type)',
  '- databaseSetup.ts: checkDatabaseHasData() (Electron bridges / Web adapter.query)',
  '- i18n: +8 keys onboarding.existingDb* (AR+EN); e2e shim: hasUsers',
  '- verification: tsc -b 0 errors; vitest run — backup, BackupPage, adapter, parity,',
  '  databaseSetup + onboardingStore — 11 files / 79 tests ✓; npm run build — 8 built',
  '- live PG: backup-restore-repro.mjs + backup-roundtrip-smoke.mjs — read→encode→decode→restore in ROLLBACK',
  '',
].join('\n'));

for (const f of ['scripts/append-agents-note.cjs', 'scripts/cleanup-debug.cjs', 'scripts/tsc-check.cjs']) {
  try { fs.rmSync(f, { force: true }); } catch { /* best-effort */ }
}

const files = [
  'AGENTS.md',
  'e2e/vite-e2e-plugin.ts',
  'electron/dbHandler.js',
  'electron/preload.cjs',
  'electron/preload.js',
  'src/app/onboarding/OnboardingWizard.tsx',
  'src/core/backup/backupTables.ts',
  'src/core/database/adapters/electronPgAdapter.ts',
  'src/core/database/databaseSetup.ts',
  'src/core/database/databaseSetup.test.ts',
  'src/core/i18n/ar.json',
  'src/core/i18n/en.json',
  'src/core/store/onboardingStore.ts',
  'src/core/store/onboardingStore.test.ts',
  'drizzle/0003_sessions.sql',
  'drizzle/0004_doc_version_columns.sql',
  'drizzle/0005_document_number_uniques.sql',
  'drizzle/0006_audit_session_id.sql',
  'scripts/backup-restore-repro.mjs',
  'scripts/backup-roundtrip-smoke.mjs',
  'scripts/ts-loader.mjs',
  'scripts/ts-register.mjs',
  'scripts/run-vitest.cjs',
];
execSync(`git add ${files.map((f) => `"${f}"`).join(' ')}`, { cwd });
const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
console.log(
  status
    .split('\n')
    .filter((l) => /^A  |^M /.test(l))
    .map((l) => l.slice(0, 60))
    .join('\n'),
);
