// مشرف خادم التطوير — يعيد تشغيل vite تلقائياً إذا توقف
// التشغيل: node scripts/vite-supervisor.mjs
import { spawn } from 'node:child_process';

function start() {
  const child = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--config', 'vite.e2e.config.ts',
    '--port', '5173', '--strictPort', '--host', '127.0.0.1',
  ], { stdio: 'inherit' });
  console.log('[supervisor] vite started pid=' + child.pid);
  child.on('exit', (code) => {
    console.log('[supervisor] vite exited code=' + code + ' — restarting in 3s');
    setTimeout(start, 3000);
  });
}
start();
