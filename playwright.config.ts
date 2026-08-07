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
    command: 'npx vite --config vite.e2e.config.ts --port 5173 --strictPort --host 127.0.0.1',
    url: VITE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
