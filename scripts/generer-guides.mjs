// Génère, après « vite build », les pages statiques des guides et les fichiers
// de référencement dans dist/ :
//   /guides/                 la liste        /sitemap.xml   /robots.txt
//   /guides/<slug>/          un guide        /llms.txt      /llms-full.txt
// Des pages HTML complètes, lisibles sans exécuter de JavaScript : c'est ce que
// lisent les moteurs de recherche et, surtout, les robots des assistants IA.
//
// Publication programmée : seuls les guides dont la date est atteinte sont
// générés. Un guide daté dans l'avenir paraît donc au premier déploiement qui
// suit sa date. GUIDES_TOUS=1 les génère tous (aperçu).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { CATEGORIES, controler, lireGuides } from './guides.mjs';

const INDEXNOW = '2deb548270bedf2788f1e54f917fab25';
const SITE = (process.env.SITE_URL ?? 'https://constatio.fr').replace(/\/+$/, '');
const DIST = new URL('../dist/', import.meta.url).pathname;
const aujourdhui = new Date().toISOString().slice(0, 10);

const tous = lireGuides();
const slugs = tous.map((g) => g.slug);
let invalide = false;
for (const g of tous) {
  const { erreurs, avis } = controler(g, slugs);
  for (const e of erreurs) { console.error(`✗ ${g.slug} : ${e}`); invalide = true; }
  for (const a of avis) console.warn(`! ${g.slug} : ${a}`);
}
if (invalide) process.exit(1);

const publies = tous.filter((g) => process.env.GUIDES_TOUS === '1' || g.date <= aujourdhui);
const publiesSlugs = new Set(publies.map((g) => g.slug));

// Typographie française : pas de retour à la ligne avant « : ; ? ! » ni après un guillemet ouvrant.
const typo = (s) => String(s).replace(/(?<=[\p{L}\p{N}»%€)]) (?=[:;?!»])/gu, '\u00a0').replace(/« /g, '«\u00a0');
const e = (s) => typo(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateFr = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const css = readdirSync(`${DIST}assets`).find((f) => /^index-.*\.css$/.test(f));
const jsonld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const EDITEUR = { '@type': 'Organization', name: 'Constatio', url: `${SITE}/` };

const STYLE = `
.g{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 4rem}
.g-liste{max-width:64rem}
.g-fil{font-size:.875rem;color:rgb(var(--discret))}.g-fil a{text-decoration:underline;text-underline-offset:3px}
.g h1{font-size:clamp(1.9rem,5vw,2.75rem);line-height:1.1;font-weight:700;margin:1rem 0 .5rem}
.g-date{font-size:.875rem;color:rgb(var(--discret))}
.g-bref{margin:1.5rem 0;padding:1.25rem;border-radius:1rem;background:rgb(var(--fond))}
.g-bref h2{font-size:1rem;margin:0 0 .5rem}.g-bref p{margin:0 0 .75rem;font-size:1.0625rem;line-height:1.6}
.g-bref ul{margin:0;padding-left:1.25rem;display:grid;gap:.35rem;list-style:revert}
.g-corps{font-size:1.0625rem;line-height:1.7}
.g-corps h2{font-size:1.5rem;line-height:1.2;font-weight:700;margin:2.25rem 0 .75rem}
.g-corps h3{font-size:1.15rem;font-weight:700;margin:1.5rem 0 .5rem}
.g-corps p{margin:0 0 1rem}.g-corps ul,.g-corps ol{margin:0 0 1rem;padding-left:1.4rem;display:grid;gap:.4rem;list-style:revert}
.g-corps a{color:rgb(var(--marque));text-decoration:underline;text-underline-offset:3px;font-weight:600}
.g-corps blockquote{margin:0 0 1rem;padding:.75rem 1rem;border-left:4px solid rgb(var(--repere));background:rgb(var(--fond))}
.g-table{overflow-x:auto;margin:0 0 1rem}.g-corps table{border-collapse:collapse;width:100%;font-size:.95rem}
.g-corps th,.g-corps td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid rgb(var(--trait));vertical-align:top}
.g-corps thead th{border-bottom:2px solid rgb(var(--encre))}
.g details{border-bottom:1px solid rgb(var(--trait));padding:.9rem 0}
.g summary{cursor:pointer;font-family:"Bricolage Grotesque Variable",sans-serif;font-weight:700;font-size:1.0625rem}
.g details p{margin:.6rem 0 0;line-height:1.6;color:rgb(var(--discret))}
.g-sources{font-size:.9rem;color:rgb(var(--discret));padding-left:1.25rem;list-style:revert}
.g-note{font-size:.875rem;color:rgb(var(--discret));border-top:1px solid rgb(var(--trait));margin-top:2rem;padding-top:1rem}
.g-appel{margin:2.5rem 0;padding:1.5rem;border-radius:1rem;background:rgb(var(--marque));color:rgb(var(--sur-marque))}
.g-appel p{margin:0 0 1rem;font-size:1.0625rem}
.g-bouton{display:inline-block;padding:.8rem 1.25rem;border-radius:.75rem;background:rgb(var(--repere));color:rgb(var(--sur-repere));font-weight:600}
.g-cartes{display:grid;gap:0;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));border-top:2px solid rgb(var(--encre));list-style:none;padding:0;margin:0}
.g-cartes li{padding:1.1rem 1rem 1.1rem 0;border-bottom:1px solid rgb(var(--trait))}
.g-cartes a{font-family:"Bricolage Grotesque Variable",sans-serif;font-weight:700;font-size:1.1rem;line-height:1.25}
.g-cartes p{margin:.4rem 0 0;font-size:.95rem;color:rgb(var(--discret));line-height:1.5}
.g-cat{font-size:.8rem;color:rgb(var(--discret))}
.g-entete{border-bottom:1px solid rgb(var(--trait));background:rgb(var(--surface))}
.g-entete div{max-width:64rem;margin:0 auto;padding:.75rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.g-logo{font-family:"Bricolage Grotesque Variable",sans-serif;font-weight:700;font-size:1.25rem;color:rgb(var(--marque))}
.g-nav{display:flex;gap:1.25rem;font-size:.9rem;font-weight:600}
.g-pied{border-top:1px solid rgb(var(--trait));font-size:.875rem;color:rgb(var(--discret));text-align:center;padding:1.5rem 1rem}
body{background:rgb(var(--surface))}`;

function page({ chemin, titre, description, tete = '', corps }) {
  const url = `${SITE}${chemin}`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(titre)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${url}">
<meta property="og:site_name" content="Constatio">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${e(titre)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Résumé pour les assistants IA">
<meta name="theme-color" content="#0f4c4a">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/assets/${css}">
<style>${STYLE}</style>
${tete}
</head>
<body>
<header class="g-entete"><div><a class="g-logo" href="/" aria-label="Constatio, accueil"><img src="/logo-constatio.webp" alt="Constatio" width="840" height="183" style="height:2rem;width:auto;display:block"></a><nav class="g-nav" aria-label="Navigation"><a href="/guides/">Guides</a><a href="/#tarifs">Tarifs</a><a href="/connexion">Connexion</a></nav></div></header>
${corps}
<footer class="g-pied">Service partenaire de Signabail, conçu par LOTIER, 40 rue Française, 34500 Béziers.<br><a href="/guides/">Guides</a> · <a href="/#tarifs">Tarifs</a> · <a href="/cgv/">Conditions générales</a> · <a href="/mentions-legales/">Mentions légales</a> · <a href="/confidentialite/">Confidentialité</a></footer>
</body>
</html>
`;
}

function ecrire(chemin, contenu) {
  const dossier = `${DIST}${chemin.replace(/^\//, '')}`;
  mkdirSync(dossier, { recursive: true });
  writeFileSync(`${dossier}index.html`, contenu);
}

// Liens internes : barre finale (page statique), et pas de lien vers un guide pas encore paru.
const rendu = new marked.Renderer();
rendu.link = ({ href, tokens }) => {
  const texte = marked.Parser.parseInline(tokens);
  const m = /^\/guides\/([^/#]+)\/?$/.exec(href);
  if (!m) return `<a href="${e(href)}">${texte}</a>`;
  return publiesSlugs.has(m[1]) ? `<a href="/guides/${m[1]}/">${texte}</a>` : texte;
};
rendu.table = function (jeton) {
  return `<div class="g-table">${marked.Renderer.prototype.table.call(this, jeton)}</div>`;
};

for (const g of publies) {
  const chemin = `/guides/${g.slug}/`;
  const voisins = publies.filter((x) => x.slug !== g.slug && x.categorie === g.categorie).slice(0, 3);
  const donnees = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: g.titre, description: g.description, abstract: g.resume, inLanguage: 'fr-FR',
      datePublished: g.date, dateModified: g.maj ?? g.date, author: EDITEUR, publisher: EDITEUR, mainEntityOfPage: `${SITE}${chemin}`, articleSection: g.categorie, citation: g.sources },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: g.questions.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.r } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Constatio', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE}/guides/` },
      { '@type': 'ListItem', position: 3, name: g.titre, item: `${SITE}${chemin}` }] },
  ];
  ecrire(chemin, page({
    chemin, titre: `${g.titre} | Constatio`, description: g.description,
    tete: `<meta property="og:type" content="article">\n<meta property="article:published_time" content="${g.date}">\n${donnees.map(jsonld).join('\n')}`,
    corps: `<main class="g">
<p class="g-fil"><a href="/">Constatio</a> › <a href="/guides/">Guides</a> › ${e(g.categorie)}</p>
<h1>${e(g.titre)}</h1>
<p class="g-date">Publié le <time datetime="${g.date}">${dateFr(g.date)}</time>${g.maj ? `, mis à jour le <time datetime="${g.maj}">${dateFr(g.maj)}</time>` : ''}</p>
<section class="g-bref" aria-labelledby="bref"><h2 id="bref">En bref</h2><p>${e(g.resume)}</p><ul>${g.points_cles.map((p) => `<li>${e(p)}</li>`).join('')}</ul></section>
<div class="g-corps">${marked.parse(typo(g.corps), { renderer: rendu })}</div>
<section aria-labelledby="questions"><div class="g-corps"><h2 id="questions">Questions fréquentes</h2></div>
${g.questions.map((x) => `<details><summary>${e(x.q)}</summary><p>${e(x.r)}</p></details>`).join('\n')}</section>
<div class="g-appel"><p>Faites votre état des lieux sur votre téléphone, pièce par pièce. Le brouillon est gratuit.</p><a class="g-bouton" href="/inscription">Commencer mon état des lieux</a></div>
<section aria-labelledby="sources"><div class="g-corps"><h2 id="sources">Textes cités</h2></div><ul class="g-sources">${g.sources.map((s) => `<li>${e(s)}</li>`).join('')}</ul></section>
${voisins.length ? `<section aria-labelledby="suite"><div class="g-corps"><h2 id="suite">À lire aussi</h2><ul>${voisins.map((v) => `<li><a href="/guides/${v.slug}/">${e(v.titre)}</a></li>`).join('')}</ul></div></section>` : ''}
<p class="g-note">Information générale sur la location à usage de résidence principale en France, à jour à la date indiquée. Elle ne remplace pas le conseil d'un professionnel du droit sur votre situation.</p>
</main>`,
  }));
}

// Liste des guides
ecrire('/guides/', page({
  chemin: '/guides/', titre: 'Guides de l’état des lieux : obligations, dépôt de garantie, cas pratiques | Constatio',
  description: 'Tout ce qu’un bailleur doit savoir sur l’état des lieux : mentions obligatoires, dépôt de garantie, vétusté, meublé, compteurs, clés. Avec les textes de loi.',
  tete: jsonld({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Guides de l’état des lieux', url: `${SITE}/guides/`, inLanguage: 'fr-FR', publisher: EDITEUR,
    hasPart: publies.map((g) => ({ '@type': 'Article', headline: g.titre, url: `${SITE}/guides/${g.slug}/`, datePublished: g.date })) }),
  corps: `<main class="g g-liste">
<p class="g-fil"><a href="/">Constatio</a> › Guides</p>
<h1>Guides de l’état des lieux</h1>
<p class="g-corps">Les règles de l’état des lieux et du dépôt de garantie, expliquées simplement, avec l’article de loi à chaque fois.</p>
${publies.length ? CATEGORIES.filter((c) => publies.some((g) => g.categorie === c)).map((c) => `<section aria-labelledby="c-${CATEGORIES.indexOf(c)}"><div class="g-corps"><h2 id="c-${CATEGORIES.indexOf(c)}">${e(c)}</h2></div>
<ul class="g-cartes">${[...publies].filter((g) => g.categorie === c).reverse().map((g) => `<li><a href="/guides/${g.slug}/">${e(g.titre)}</a><p>${e(g.description)}</p><p class="g-cat"><time datetime="${g.date}">${dateFr(g.date)}</time></p></li>`).join('')}</ul></section>`).join('\n')
    : `<p class="g-corps">Le premier guide paraît le ${dateFr(tous[0].date)}.</p>`}
</main>`,
}));

// Plan du site, robots, et fichiers destinés aux assistants IA
const pages = [{ loc: '/', maj: aujourdhui }, { loc: '/guides/', maj: publies.at(-1)?.date ?? aujourdhui }, ...['/mentions-legales/', '/cgv/', '/confidentialite/'].map((loc) => ({ loc, maj: aujourdhui })), ...publies.map((g) => ({ loc: `/guides/${g.slug}/`, maj: g.maj ?? g.date }))];
writeFileSync(`${DIST}sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE}${p.loc}</loc><lastmod>${p.maj}</lastmod></url>`).join('\n')}\n</urlset>\n`);
// Les robots des assistants IA sont nommés un par un : beaucoup d'éditeurs les bloquent par défaut, ici ils sont les bienvenus.
const ROBOTS_IA = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'MistralAI-User', 'CCBot', 'Bingbot', 'Googlebot'];
const PRIVE = ['/app', '/admin', '/passage', '/signer', '/reserves', '/rejoindre', '/connexion', '/inscription', '/mot-de-passe-oublie', '/nouveau-mot-de-passe'].map((c) => `Disallow: ${c}`).join('\n');
writeFileSync(`${DIST}robots.txt`, `# Le site public est ouvert à tous les robots, y compris ceux des assistants IA.\n# L'application (comptes, états des lieux, liens de signature) n'a rien à indexer.\nUser-agent: *\nAllow: /\n${PRIVE}\n\n${ROBOTS_IA.map((r) => `User-agent: ${r}`).join('\n')}\nAllow: /\n${PRIVE}\n\nSitemap: ${SITE}/sitemap.xml\n# Résumé du site pour les assistants IA : ${SITE}/llms.txt\n`);
writeFileSync(`${DIST}llms.txt`, `# Constatio

> Service en ligne pour réaliser un état des lieux locatif (entrée, sortie, relevé d'état) depuis un téléphone, en France. Pièce par pièce, avec contrôle des mentions obligatoires du décret n° 2016-382 du 30 mars 2016, photos datées et localisées, fonctionnement sans réseau et comparaison entre l'entrée et la sortie. Service partenaire de Signabail (rédaction de baux), conçu par LOTIER, agence immobilière à Béziers.

- Public : bailleurs particuliers, SCI, agences et gestionnaires.
- Droit applicable : location à usage de résidence principale en France (loi n° 89-462 du 6 juillet 1989).
- Le brouillon est gratuit ; le paiement intervient à la génération du document définitif.
- Les guides ci-dessous sont une information générale ; ils citent leurs textes et ne remplacent pas un conseil juridique.

## Guides

${publies.map((g) => `- [${g.titre}](${SITE}/guides/${g.slug}/) : ${g.resume}`).join('\n')}

## Pages

- [Accueil](${SITE}/) : présentation, fonctionnement, tarifs, questions fréquentes
- [Tous les guides](${SITE}/guides/)
- [Conditions générales](${SITE}/cgv/) : crédits, abonnements, rétractation, signature électronique
- [Mentions légales](${SITE}/mentions-legales/)
- [Confidentialité](${SITE}/confidentialite/)
- [Texte complet des guides](${SITE}/llms-full.txt)
`);
writeFileSync(`${DIST}llms-full.txt`, `# Constatio — texte complet des guides\n\n${publies.map((g) => `## ${g.titre}\n\nAdresse : ${SITE}/guides/${g.slug}/\nPublié le ${g.date}. Catégorie : ${g.categorie}.\n\n${g.resume}\n\n${g.points_cles.map((p) => `- ${p}`).join('\n')}\n\n${g.corps.replace(/^## /gm, '### ')}\n\n### Questions fréquentes\n\n${g.questions.map((x) => `**${x.q}** ${x.r}`).join('\n\n')}\n\nTextes cités : ${g.sources.join(' ; ')}.`).join('\n\n---\n\n')}\n`);

// Base de l'assistant du site : les questions de tous les guides, et le résumé de chacun.
// Un guide pas encore paru répond déjà, mais sans lien vers sa page.
const fiches = tous.flatMap((g) => {
  const url = publiesSlugs.has(g.slug) ? `/guides/${g.slug}/` : null;
  return [{ q: g.titre, r: g.resume, url, source: 'Lire le guide' }, ...g.questions.map((x) => ({ q: x.q, r: x.r, url, source: `Guide : ${g.titre}` }))];
});
writeFileSync(`${DIST}assistant.json`, JSON.stringify(fiches));

// IndexNow (Bing, et par lui plusieurs assistants IA) : le jour où un guide paraît, on le signale tout de suite.
// Jamais depuis un poste de développement ; un échec n'empêche pas la publication.
const parusAujourdhui = publies.filter((g) => g.date === aujourdhui);
if (parusAujourdhui.length && !process.env.GUIDES_TOUS && !existsSync('.env.production.local')) {
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ host: 'constatio.fr', key: INDEXNOW, keyLocation: `${SITE}/${INDEXNOW}.txt`, urlList: [`${SITE}/`, `${SITE}/guides/`, ...parusAujourdhui.map((g) => `${SITE}/guides/${g.slug}/`)] }) });
    console.log(`IndexNow : ${r.status}`);
  } catch (err) { console.log(`IndexNow : non joint (${err.message})`); }
}

console.log(`guides : ${publies.length} publié(s) sur ${tous.length}${publies.length < tous.length ? ` (prochain le ${tous.find((g) => !publiesSlugs.has(g.slug)).date})` : ''}`);
