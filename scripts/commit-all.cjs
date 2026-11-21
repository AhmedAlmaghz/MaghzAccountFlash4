const fs = require('fs');
const { execSync } = require('child_process');
const cwd = 'E:\\MaghzAccountApp\\MaghzAccountFlash35';

fs.writeFileSync('commit-msg-all.txt', [
  'chore: commit all remaining pending changes (branch sync)',
  '',
  '- drizzle: meta/_journal.json + migrations.test.ts updates (migration coverage)',
  '- electron/seedDemoData.js: fix drift in seeded data',
  '- src/core/api.ts, database/adapters/pgliteAdapter.ts, database/schema/*: updates',
  '- document editors (sales/purchases/vouchers): manual-override skip fixes + pro invoice fields',
  '- auth: SessionsModal + store.sessions tests',
  '- scripts/diffstat.cjs: new helper',
  '',
].join('\n'));

execSync('git add -A', { cwd });
const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
console.log('staged entries:', status.split('\n').filter((l) => l.trim()).length);
const commitOut = execSync('git commit -F commit-msg-all.txt', { cwd, encoding: 'utf8' });
console.log(commitOut.split('\n').slice(0, 4).join('\n'));
const pushOut = execSync('git push origin NewWind-dev', { cwd, encoding: 'utf8' });
console.log('---PUSH---');
console.log(pushOut.split('\n').filter((l) => /remote:|To |new|abcdef/i.test(l)).slice(0, 4).join('\n'));
console.log('HEAD:', execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim());
