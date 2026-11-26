import { expect, test } from '@playwright/test';

// Ce que lisent un moteur de recherche ou le robot d'un assistant IA : le HTML tel qu'il est servi, sans JavaScript.
test('les pages publiques se lisent sans JavaScript, avec leurs données structurées', async ({ request }) => {
  const accueil = await (await request.get('/')).text();
  expect(accueil).toContain('<link rel="canonical" href="https://constatio.fr/">');
  expect(accueil).toMatch(/<h1[^>]*>[^<]*état des lieux/i);
  for (const attendu of ['Questions', 'Tarifs', '14,90', 'décret n° 2016-382', 'og:image']) expect(accueil, attendu).toContain(attendu);
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
});

test('l’espace client ne laisse pas apparaître la page d’accueil écrite dans le HTML', async ({ page }) => {
  await page.goto('/connexion');
  await expect(page.getByRole('heading', { name: /Connexion|Se connecter|Bon retour/i }).first()).toBeVisible();
  await expect(page.locator('[data-prerendu]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('état des lieux');
});
