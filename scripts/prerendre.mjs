// Écrit les pages publiques (accueil, pages légales) en HTML dans dist/, après « vite build ».
// Le contenu vient des mêmes composants que l'application (src/prerendu.tsx) : aucune copie à tenir à jour.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const SITE = 'https://constatio.fr';
const e = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Les modules de l'application supposent un navigateur : on leur donne le strict minimum pour se charger.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Les prix sont ceux de l'administration, lus dans la base au moment de construire le site.
// Base injoignable : on garde les derniers prix connus (src/lib/tarifs.ts), sans faire échouer la mise en ligne.
const env = Object.fromEntries(['.env.production', '.env.production.local'].filter((f) => existsSync(f)).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]])));
let tarifs = null;
try {
  // En local, l'adresse du site sert de relais vers la base ; à la construction, on vise la base directement.
  const base = env.DEV_PROXY_REST ? `${env.DEV_PROXY_REST}/tarifs` : `${env.VITE_SUPABASE_URL}/rest/v1/tarifs`;
  const r = await fetch(`${base}?select=code,montant_cents&actif=is.true`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` }, signal: AbortSignal.timeout(8000) });
  const lignes = r.ok ? await r.json() : [];
  if (Array.isArray(lignes) && lignes.length) tarifs = Object.fromEntries(lignes.map((t) => [t.code, t.montant_cents]));
  console.log(tarifs ? `tarifs : ${lignes.length} prix lus dans l'administration` : `tarifs : base muette (${r.status}), prix de secours`);
} catch (err) { console.log(`tarifs : base non jointe (${err.message}), prix de secours`); }
if (tarifs) globalThis.__TARIFS__ = tarifs;

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', mode: 'production', optimizeDeps: { noDiscovery: true, include: [] } });
let liste;
try { liste = (await vite.ssrLoadModule('/src/prerendu.tsx')).pages(); } finally { await vite.close(); }

const gabarit = readFileSync('dist/index.html', 'utf8');
if (!gabarit.includes('<!--tete:debut-->') || !gabarit.includes('<div id="root"></div>')) throw new Error('dist/index.html : repères de pré-rendu introuvables');
for (const p of liste) {
  const url = `${SITE}${p.chemin}`;
  const tete = `<title>${e(p.titre)}</title>
    <meta name="description" content="${e(p.description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website"><meta property="og:site_name" content="Constatio"><meta property="og:locale" content="fr_FR">
    <meta property="og:title" content="${e(p.titre)}"><meta property="og:description" content="${e(p.description)}"><meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    ${p.donnees.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n    ')}`;
  const html = gabarit
    .replace('<html lang="fr">', `<html lang="fr" data-chemin="${p.chemin}">`)
    .replace(/<!--tete:debut-->[\s\S]*<!--tete:fin-->/, tete)
    .replace('<div id="root"></div>', `<div id="root"><div data-prerendu>${p.html}</div></div>${tarifs ? `<script>window.__TARIFS__=${JSON.stringify(tarifs).replace(/</g, '\\u003c')}</script>` : ''}`);
  const dossier = `dist${p.chemin}`;
  mkdirSync(dossier, { recursive: true });
  writeFileSync(`${dossier}index.html`, html);
}
console.log(`pré-rendu : ${liste.map((p) => p.chemin).join(' ')}`);
process.exit(0);
