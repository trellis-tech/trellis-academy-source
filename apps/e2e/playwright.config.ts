import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './core/instance'

/**
 * E2E config for the LearnHouse UI acceptance suite.
 *
 * Release-one specs drive the Trellis SSO learner journey against a real local
 * self-host. The upstream native-auth assignment suites remain source-only and
 * are deliberately excluded from this project.
 */
export default defineConfig({
  testDir: './features',
  testMatch: 'trellis-sso/tests/**/*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // Multi-user UI flows are slow; give each test room and only one at a time.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // This serial journey intentionally shares seeded learning state across tests.
  // Retrying one test without rerunning global setup would reuse partially
  // mutated state and produce a misleading result.
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
