const { execSync } = require('child_process');
const targets = process.argv.slice(2).join(' ');
try {
  const out = execSync(`npx vitest run ${targets} --pool=threads`, { encoding: 'utf8', timeout: 900000 });
  const summary = out.split('\n').filter((l) => /Test Files|Tests |FAIL/.test(l));
  console.log(summary.join('\n').slice(0, 1600));
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || e.message));
  const summary = out.split('\n').filter((l) => /Test Files|Tests |FAIL|No test files|no test files/i.test(l));
  console.log(summary.length ? summary.join('\n').slice(0, 1600) : out.slice(0, 1200));
}
