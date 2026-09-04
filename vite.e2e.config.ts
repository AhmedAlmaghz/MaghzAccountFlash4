import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { e2eDbBridge } from './e2e/vite-e2e-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // fall through to dev fallback
  }
  return '0.0.0-dev';
}

export default defineConfig({
  plugins: [react(), e2eDbBridge({ envPath: path.resolve(__dirname, '.env.local') })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Keep in sync with vite.config.ts — pgliteAdapter statically imports
      // the drizzle SQL migrations via @root/*.sql?raw.
      '@root': path.resolve(__dirname, './'),
    },
  },
  define: {
    'import.meta.env.VITE_E2E': JSON.stringify('1'),
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
});
