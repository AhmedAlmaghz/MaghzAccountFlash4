import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['node_modules', 'dist', 'e2e/**', 'test-results/**', 'playwright-report/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      '@root': path.resolve(rootDir, './'),
    },
  },
});
