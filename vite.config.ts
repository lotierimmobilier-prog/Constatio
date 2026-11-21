import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Pile locale (dev/pile-locale.sh) : le serveur de développement relaie
  // /auth/v1 et /rest/v1 vers les services locaux, comme le fait Supabase.
  const proxy =
    env.DEV_PROXY_AUTH && env.DEV_PROXY_REST
      ? {
          '/auth/v1': { target: env.DEV_PROXY_AUTH, rewrite: (p: string) => p.replace(/^\/auth\/v1/, '') },
          '/rest/v1': { target: env.DEV_PROXY_REST, rewrite: (p: string) => p.replace(/^\/rest\/v1/, '') },
          ...(env.DEV_PROXY_FONCTIONS ? { '/functions/v1': { target: env.DEV_PROXY_FONCTIONS, rewrite: (p: string) => p.replace(/^\/functions\/v1/, '') } } : {}),
          ...(env.DEV_PROXY_STOCKAGE ? { '/storage/v1': { target: env.DEV_PROXY_STOCKAGE, rewrite: (p: string) => p.replace(/^\/storage\/v1/, '') } } : {}),
        }
      : undefined;
  return {
    plugins: [
      react(),
      // Application installable, ouverte même sans réseau : l'interface est mise en
      // cache par le service worker ; les données, elles, vivent dans le magasin local.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Constatio — états des lieux',
          short_name: 'Constatio',
          description: 'Un état des lieux incontestable en 20 minutes, depuis votre téléphone.',
          lang: 'fr',
          start_url: '/app',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f3f6f5',
          theme_color: '#0f4c4a',
          icons: [
            { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: '/index.html',
          // Les appels au serveur ne passent jamais par le cache.
          // Ni les appels au serveur ni les guides (pages statiques à part) ne passent par l'application.
          navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//, /^\/storage\//, /^\/functions\//, /^\/guides/, /^\/(sitemap\.xml|robots\.txt|llms(-full)?\.txt)$/],
        },
      }),
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    test: {
      include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'scripts/**/*.test.ts'],
      // Les tests de fonctions n'appellent jamais Supabase ; ces valeurs évitent seulement l'erreur de configuration.
      env: { VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'test' },
    },
  };
});
