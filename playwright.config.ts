import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Garde-fou : ces tests créent et effacent des comptes. Ils ne tournent que contre la pile
// locale (dev/pile-locale.sh), jamais contre la base de constatio.fr.
if (!existsSync('.env.production.local') || !/VITE_SUPABASE_URL=http:\/\/127\.0\.0\.1/.test(readFileSync('.env.production.local', 'utf8')))
  throw new Error('Tests refusés : lancez dev/pile-locale.sh start (le site construit viserait sinon la vraie base).');


// Tests de bout en bout sur téléphone, contre la pile locale (dev/pile-locale.sh start).
// Ils tournent sur la version de production (service worker compris), pas sur le serveur de développement.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', ...devices['Pixel 7'] },
  webServer: { command: 'npm run build && npm run preview', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 120_000 },
});
