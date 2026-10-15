import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1366, height: 768 }, // common Chromebook resolution
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.test 127.0.0.1'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
  },
  webServer: [
    { command: 'node tests/e2e/fixtures.mjs', port: 4101, reuseExistingServer: true },
    {
      command: 'npx vite build && npx vite preview --config vite.e2e.config.ts --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
