import { defineConfig } from '@playwright/test';

// e2e runs against scripts/dev-server.js (static files + vercel.json rewrites,
// /api proxied to PROXY_TARGET, default https://armenu.co.za).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'node scripts/dev-server.js',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
