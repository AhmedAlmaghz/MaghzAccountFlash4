import fs from 'fs';
let s = fs.readFileSync('scripts/add-reports-i18n.mjs', 'utf8');
s = s.replace("const fs = require('fs');", "import fs from 'fs';");
fs.writeFileSync('scripts/add-reports-i18n.mjs', s);
console.log('converted');
