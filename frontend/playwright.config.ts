import { defineConfig, devices } from '@playwright/test';
import { env } from 'node:process';

const baseURL = env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const target = new URL(baseURL);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

if (
  !['http:', 'https:'].includes(target.protocol) ||
  !loopbackHosts.has(target.hostname) ||
  target.username ||
  target.password ||
  target.pathname !== '/' ||
  target.search ||
  target.hash
) {
  throw new Error(
    'E2E_BASE_URL must be a loopback origin, such as http://127.0.0.1:3000. Browser tests create and delete disposable records; hosted demos are not allowed.',
  );
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    [env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: target.origin,
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
