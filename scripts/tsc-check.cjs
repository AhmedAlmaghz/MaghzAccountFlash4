const { execSync } = require('child_process');
try {
  const out = execSync('npx tsc -b', { encoding: 'utf8', timeout: 300000 });
  console.log('TSC OK (no output).' + out.slice(0, 400));
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || e.message));
  const errs = out.match(/error TS[^\n]*/g) || [];
  console.log('TSC ERRORS (' + errs.length + '):');
  console.log(errs.slice(0, 25).join('\n'));
  console.log('--- tail ---');
  console.log(out.slice(-600));
}
