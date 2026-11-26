import { expect, test } from '@playwright/test';

// Ce que lisent un moteur de recherche ou le robot d'un assistant IA : le HTML tel qu'il est servi, sans JavaScript.
test('les pages publiques se lisent sans JavaScript, avec leurs données structurées', async ({ request }) => {
  const accueil = await (await request.get('/')).text();
  expect(accueil).toContain('<link rel="canonical" href="https://constatio.fr/">');
  expect(accueil).toMatch(/<h1[^>]*>[^<]*état des lieux/i);
  for (const attendu of ['Questions', 'Tarifs', 'tarif-edl_unite', 'décret n° 2016-382', 'og:image']) expect(accueil, attendu).toContain(attendu);
  const blocs = [...accueil.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  expect(blocs.map((b) => b['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  expect(blocs[3].mainEntity.length).toBeGreaterThan(4);
  expect(blocs[2].offers.find((o: { name: string }) => /unité/i.test(o.name)).price).toBe('14.90');

  const cgv = await (await request.get('/cgv/')).text();
  expect(cgv).toContain('<link rel="canonical" href="https://constatio.fr/cgv/">');
  expect(cgv).toContain('Droit de rétractation');

  const robots = await (await request.get('/robots.txt')).text();
  for (const r of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Disallow: /app', 'Disallow: /signer', 'Sitemap: https://constatio.fr/sitemap.xml']) expect(robots, r).toContain(r);
  const plan = await (await request.get('/sitemap.xml')).text();
  for (const u of ['https://constatio.fr/</loc>', '/guides/</loc>', '/cgv/</loc>', '/mentions-legales/</loc>']) expect(plan, u).toContain(u);
  expect(await (await request.get('/llms.txt')).text()).toContain('# Constatio');
});

test('un guide paru porte ses questions en pied d’article et leurs données structurées', async ({ request }) => {
  const plan = await (await request.get('/sitemap.xml')).text();
  const guide = /<loc>https:\/\/constatio\.fr(\/guides\/[^<]+\/)<\/loc>/.exec(plan.replace('/guides/</loc>', ''))?.[1];
  test.skip(!guide, 'aucun guide paru à cette date');
  const html = await (await request.get(guide!)).text();
  expect(html).toContain('Questions fréquentes');
  expect(html.indexOf('Questions fréquentes')).toBeGreaterThan(html.indexOf('En bref'));
  const types = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1])['@type']);
  expect(types).toEqual(['Article', 'FAQPage', 'BreadcrumbList']);
  // Illustration : présente, décrite pour qui ne la voit pas, et reprise comme image de partage.
  const image = /<figure class="g-image"><img src="([^"]+)" alt="([^"]+)" width="1200" height="630"/.exec(html);
  expect(image, 'illustration du guide').not.toBeNull();
  expect(image![2].length).toBeGreaterThan(60);
  expect((await request.get(image![1])).headers()['content-type']).toContain('image/jpeg');
  expect(html).toContain(`<meta property="og:image" content="https://constatio.fr${image![1]}">`);
  expect(plan).toContain(`<image:loc>https://constatio.fr${image![1]}</image:loc>`);
  // Aucune image sans texte alternatif, ici comme dans la liste des guides.
  for (const page of [html, await (await request.get('/guides/')).text()]) for (const [balise] of page.matchAll(/<img\b[^>]*>/g)) expect(balise, balise).toMatch(/\balt="[^"]+"/);
});

test('l’espace client ne laisse pas apparaître la page d’accueil écrite dans le HTML', async ({ page }) => {
  await page.goto('/connexion');
  await expect(page.getByRole('heading', { name: /Connexion|Se connecter|Bon retour/i }).first()).toBeVisible();
  await expect(page.locator('[data-prerendu]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('état des lieux');
});

test('le prix affiché sur la page d’accueil est celui saisi dans l’administration', async ({ page }) => {
  const { execFileSync } = await import('node:child_process');
  const sql = (r: string) => execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-At', '-c', r], { encoding: 'utf8' }).trim();
  const avant = sql(`select montant_cents from public.tarifs where code = 'edl_unite'`);
  try {
    sql(`update public.tarifs set montant_cents = 1234 where code = 'edl_unite'; update public.tarifs set actif = false where code = 'pack_10'`);
    await page.goto('/');
    await expect(page.getByTestId('tarif-edl_unite')).toContainText('12,34');
    // Une offre retirée de la vente disparaît du barème.
    await expect(page.getByTestId('tarif-pack_10')).toHaveCount(0);
    await expect(page.getByTestId('tarif-pack_5')).toBeVisible();
  } finally {
    sql(`update public.tarifs set montant_cents = ${avant} where code = 'edl_unite'; update public.tarifs set actif = true where code = 'pack_10'`);
  }
});
