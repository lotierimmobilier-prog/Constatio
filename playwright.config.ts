import { defineConfig, devices } from '@playwright/test';

// Tests de bout en bout sur téléphone, contre la pile locale (dev/pile-locale.sh start).
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', ...devices['Pixel 7'] },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
