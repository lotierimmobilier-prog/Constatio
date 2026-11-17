import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Pile locale (dev/pile-locale.sh) : le serveur de développement relaie
  // /auth/v1 et /rest/v1 vers les services locaux, comme le fait Supabase.
  const proxy =
    env.DEV_PROXY_AUTH && env.DEV_PROXY_REST
      ? {
          '/auth/v1': { target: env.DEV_PROXY_AUTH, rewrite: (p: string) => p.replace(/^\/auth\/v1/, '') },
          '/rest/v1': { target: env.DEV_PROXY_REST, rewrite: (p: string) => p.replace(/^\/rest\/v1/, '') },
        }
      : undefined;
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    test: {
      include: ['src/**/*.test.ts'],
      // Les tests de fonctions n'appellent jamais Supabase ; ces valeurs évitent seulement l'erreur de configuration.
      env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'test' },
    },
  };
});
