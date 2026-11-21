const { execSync } = require('child_process');
const targets = process.argv.slice(2).join(' ') ||
  'src/core/backup src/modules/core/components/BackupPage.test.tsx src/core/database/databaseSetup.test.ts src/core/store/onboardingStore.test.ts src/core/database/adapters/electronPgAdapter.test.ts electron/dbIpcParity.test.js';
try {
  const out = execSync(`npx vitest run ${targets} --pool=threads`, { encoding: 'utf8', timeout: 900000 });
  const summary = out.split('\n').filter((l) => /Test Files|Tests |Duration|FAIL/.test(l));
  console.log(summary.join('\n').slice(0, 1200));
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || e.message));
  const summary = out.split('\n').filter((l) => /Test Files|Tests |FAIL|failed|passed/.test(l));
  console.log(summary.join('\n').slice(0, 1200));
}
