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

/**
 * Dev-only twin of api/jev-systemone.ts (Vercel serverless relay).
 * Browsers cannot call api.typesafe.ai directly (its CORS preflight answers
 * HTTP 400 with no ACAO header), so dev traffic rides this same-origin relay
 * exactly like production rides the serverless function. Same contract:
 * POST /api/jev-systemone { state, questions, model?, apiKey } → upstream
 * { model, answers, usage }. Dev-only: production uses api/jev-systemone.ts.
 */
function jevRelayPlugin() {
  // Fixed upstream (dev-only twin of api/jev-systemone.ts) — no allowlist
  // needed here; production enforces JEV_ALLOWED_HOSTS server-side.
  return {
    name: 'jev-relay-dev',
    configureServer(server: { middlewares: { use: (fn: (req: never, res: never, next: () => void) => void) => void } }) {
      server.middlewares.use(((req: never, res: never, next: () => void) => {
        const r = req as unknown as { url?: string; method?: string; on: (ev: string, fn: (c?: Uint8Array) => void) => void };
        const w = res as unknown as {
          setHeader: (k: string, v: string) => void;
          end: (b?: string) => void;
          statusCode: number;
        };
        if (r.url !== '/api/jev-systemone' || r.method !== 'POST') return next();
        const chunks: Uint8Array[] = [];
        r.on('data', (c?: Uint8Array) => { if (c) chunks.push(c); });
        r.on('end', () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
                state?: unknown; questions?: Record<string, unknown>; model?: string; apiKey?: string;
              };
              const qids = body.questions && typeof body.questions === 'object' ? Object.keys(body.questions) : [];
              if (!body.state || qids.length === 0 || qids.length > 40 || !body.apiKey) {
                w.statusCode = 400;
                w.end(JSON.stringify({ success: false, error: 'state, 1-40 questions and apiKey required' }));
                return;
              }
              const upstream = await fetch('https://api.typesafe.ai/v1/systemone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
                body: JSON.stringify({ state: body.state, questions: body.questions, model: body.model || 'jev-latest' }),
                signal: AbortSignal.timeout(20000),
              });
              const text = await upstream.text();
              w.statusCode = upstream.ok ? 200 : 502;
              w.setHeader('Content-Type', 'application/json');
              w.end(text || '{}');
            } catch (e) {
              w.statusCode = 504;
              w.setHeader('Content-Type', 'application/json');
              w.end(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
            }
          })();
        });
      }) as (req: never, res: never, next: () => void) => void);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), versionJsonPlugin(), jevRelayPlugin()],
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
