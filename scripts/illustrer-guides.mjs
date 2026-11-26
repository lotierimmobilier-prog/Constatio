// Dessine l'illustration de chaque guide (1200 × 630, JPEG) dans public/guides/illustrations/.
// À lancer à la main après avoir ajouté ou modifié un guide : « node scripts/illustrer-guides.mjs »
// (« --tout » redessine celles qui existent). Les images sont versionnées : la mise en ligne
// ne dépend ni d'un navigateur ni d'un service extérieur.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { lireGuides } from './guides.mjs';

const RACINE = new URL('../', import.meta.url).pathname;
const SORTIE = `${RACINE}public/guides/illustrations/`;
mkdirSync(SORTIE, { recursive: true });
const b64 = (chemin) => readFileSync(`${RACINE}${chemin}`).toString('base64');
const POLICES = `
@font-face{font-family:Titre;src:url(data:font/woff2;base64,${b64('node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')}) format('woff2');font-weight:200 800}
@font-face{font-family:Texte;src:url(data:font/woff2;base64,${b64('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}`;
const LOGO = `data:image/png;base64,${b64('public/logo-constatio.png')}`;
const e = (s) => String(s).replace(/'/g, '’').replace(/ (?=[:;?!])/g, '\u00a0').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Un pictogramme par catégorie, tracé au trait.
const PICTOS = {
  'Obligations': '<path d="M14 6h22l10 10v38H14z"/><path d="M36 6v10h10"/><path d="M21 30l6 6 12-13"/><path d="M21 46h18"/>',
  'Dépôt de garantie': '<circle cx="30" cy="30" r="23"/><path d="M38 21c-2-3-5-4-8-4-6 0-10 6-10 13s4 13 10 13c3 0 6-1 8-4"/><path d="M15 27h15M15 33h15"/>',
  'Cas particuliers': '<path d="M30 8l24 42H6z"/><path d="M30 24v12"/><circle cx="30" cy="43" r="1.5"/>',
  'Sur place': '<rect x="17" y="5" width="26" height="50" rx="5"/><path d="M26 11h8"/><path d="M24 26l5 5 8-9"/><path d="M24 42h12"/>',
};

function gabarit(g) {
  const chiffre = String(g.image_chiffre ?? '').trim();
  const taille = chiffre.length <= 4 ? 190 : chiffre.length <= 7 ? 150 : chiffre.length <= 9 ? 118 : 92;
  const titre = String(g.titre);
  return `<!doctype html><meta charset="utf-8"><style>${POLICES}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;display:grid;grid-template-columns:500px 1fr;font-family:Texte,sans-serif;background:#f3f6f5;color:#0f2f2e;overflow:hidden}
.g{background:#0f4c4a;color:#f3f6f5;padding:56px 48px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
.g::after{content:"";position:absolute;right:-60px;top:0;bottom:0;width:120px;background:#0f4c4a;transform:skewX(-6deg)}
.cat{display:flex;align-items:center;gap:16px;font-size:24px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;position:relative;z-index:1}
.cat svg{width:64px;height:64px;flex:none;fill:none;stroke:#f2b61b;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.chiffre{font-family:Titre,sans-serif;font-weight:800;font-size:${taille}px;line-height:.95;color:#f2b61b;letter-spacing:-.02em;position:relative;z-index:1;white-space:nowrap;display:inline-block}
.legende{font-size:27px;line-height:1.3;font-weight:500;position:relative;z-index:1;max-width:400px;margin-top:22px}
.d{padding:56px 56px 48px 110px;display:flex;flex-direction:column;justify-content:space-between}
h1{font-family:Titre,sans-serif;font-weight:700;font-size:${titre.length > 58 ? 50 : 56}px;line-height:1.08;letter-spacing:-.015em;text-wrap:balance}
.pied{display:flex;justify-content:space-between;align-items:flex-end;gap:24px}
.pied img{height:54px}
.pied span{font-size:22px;color:#566b69;font-weight:500}
.trait{width:96px;height:8px;border-radius:4px;background:#f2b61b;margin-bottom:28px}
</style>
<section class="g"><div class="cat"><svg viewBox="0 0 60 60">${PICTOS[g.categorie] ?? PICTOS['Obligations']}</svg>${e(g.categorie)}</div><div><div class="chiffre">${e(chiffre)}</div><p class="legende">${e(g.image_legende ?? '')}</p></div><div style="height:64px"></div></section>
<section class="d"><div><div class="trait"></div><h1>${e(titre)}</h1></div><div class="pied"><img src="${LOGO}" alt=""><span>Guide de l’état des lieux</span></div></section>`;
}

const tout = process.argv.includes('--tout');
const seuls = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const guides = lireGuides().filter((g) => (seuls.length ? seuls.includes(g.slug) : tout || !existsSync(`${SORTIE}${g.slug}.jpg`)));
const manquants = guides.filter((g) => !g.image_chiffre || !g.image_legende);
if (manquants.length) { console.error(`✗ image_chiffre ou image_legende manquant : ${manquants.map((g) => g.slug).join(', ')}`); process.exit(1); }
const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const g of guides) {
  await page.setContent(gabarit(g));
  await page.evaluate(() => document.fonts.ready);
  // Un mot-clé trop long ne doit pas sortir du panneau.
  await page.evaluate(() => { const c = document.querySelector('.chiffre'); let t = parseFloat(getComputedStyle(c).fontSize); while (c.offsetWidth > 404 && t > 40) { t -= 4; c.style.fontSize = `${t}px`; } });
  await page.screenshot({ path: `${SORTIE}${g.slug}.jpg`, type: 'jpeg', quality: 86 });
  console.log(`✓ ${g.slug}`);
}
await navigateur.close();
console.log(`${guides.length} illustration(s) dessinée(s).`);
