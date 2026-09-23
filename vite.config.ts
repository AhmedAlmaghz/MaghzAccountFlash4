import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // fall through to dev fallback
  }
  return '0.0.0-dev';
}

function versionJsonPlugin() {
  return {
    name: 'version-json',
    closeBundle() {
      try {
        const version = appVersion();
        const out = path.resolve(__dirname, './dist/version.json');
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ version, channel: version.includes('-') ? 'beta' : 'stable', builtAt: new Date().toISOString() }, null, 2));
      } catch { /* ignore — dev mode has no dist */ }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), versionJsonPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@root': path.resolve(__dirname, './'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor';
          if (id.includes('node_modules/recharts')) return 'charts';
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/html2canvas') || id.includes('node_modules/dompurify')) return 'pdf';
          if (id.includes('node_modules/xlsx')) return 'excel';
          if (id.includes('node_modules/drizzle-orm') || id.includes('node_modules/dexie')) return 'db';
          if (id.includes('node_modules/@tanstack/react-table')) return 'table';
          if (id.includes('node_modules/zod')) return 'validation';
          if (id.includes('node_modules/date-fns')) return 'dates';
          if (id.includes('node_modules/lucide-react')) return 'icons';
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
