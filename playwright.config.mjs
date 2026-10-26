import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  reporter: [['list']],
  use: {
    baseURL: pathToFileURL(resolve('dist/preview.html')).href,
    viewport: { width: 1360, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
});
