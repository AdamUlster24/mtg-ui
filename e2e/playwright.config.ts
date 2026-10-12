import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // every test plays on the same two XMage servers and the cheat file is shared: one at a time
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results/out',
  use: {
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    viewport: { width: 1600, height: 900 },
    // a click that can't land should fail the test quickly instead of waiting for the test timeout
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'scenarios', testMatch: /scenarios\/.*\.spec\.ts/ },
    { name: 'games', testMatch: /games\/.*\.spec\.ts/, timeout: 30 * 60_000 },
    { name: 'online', testMatch: /online\/.*\.spec\.ts/, timeout: 5 * 60_000 },
    { name: 'captures', testMatch: /captures\/.*\.spec\.ts/, timeout: 10 * 60_000 },
  ],
})
