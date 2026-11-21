const { execSync } = require('child_process');
const cwd = 'E:\\MaghzAccountApp\\MaghzAccountFlash35';
const diffStat = execSync('git diff --stat', { encoding: 'utf8', cwd });
const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8', cwd });
console.log('---DIFFSTAT---');
console.log(diffStat.slice(0, 2000));
console.log('---UNTRACKED---');
console.log(untracked.split('\n').filter(Boolean).join('\n'));
