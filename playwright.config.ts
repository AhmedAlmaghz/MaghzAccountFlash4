import { defineConfig, devices } from '@playwright/test';

const VITE_URL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/vite-e2e-plugin.ts', '**/fixtures/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: VITE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    // Direct node invocation — `npx` resolution stalls on this machine and
    // inside CI caches (observed: 120s webServer timeouts while the same
    // binary runs in seconds via node). node_modules is always present for
    // tests. Timeout is 240s to absorb cold dep-optimizer runs after a
    // dependency bump (observed 58s+ first boot on vite 8).
    command: 'node node_modules/vite/bin/vite.js --config vite.e2e.config.ts --port 5173 --strictPort --host 127.0.0.1',
    url: VITE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
