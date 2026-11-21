import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-photos-${Date.now()}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const element = (page: Page, categorie: string) => page.getByTestId(`element-${categorie}`).first();
const synchronise = (page: Page) => expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
/** Une vraie image : une capture de l'écran en cours. */
const image = async (page: Page, nom: string) => ({ name: nom, mimeType: 'image/png', buffer: await page.screenshot() });
const chargee = (_page: Page, cible: ReturnType<Page['locator']>) =>
  expect.poll(() => cible.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 10_000 }).toBe(true);

test.use({ permissions: ['geolocation'], geolocation: { latitude: 43.3442, longitude: 3.2158 } });

test('photos : prise, preuve, hors connexion, autre appareil, retrait', async ({ page, context, browser }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('3 quai Vallière');
  await page.getByLabel('Code postal').fill('11100');
  await page.getByLabel('Ville').fill('Narbonne');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage photos');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('reprendre').click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  // ── Une photo sur le sol : réduite, datée, localisée ─────────────────────────
  await element(page, 'sol').getByRole('button', { name: 'Détail' }).click();
  const sol = element(page, 'sol');
  // Une image de synthèse au format d'un téléphone (4000 × 3000), pour vérifier la réduction.
  const grande = await page.evaluate(() => {
    const t = document.createElement('canvas');
    t.width = 4000; t.height = 3000;
    const c = t.getContext('2d')!;
    const fond = c.createLinearGradient(0, 0, 4000, 3000);
    fond.addColorStop(0, '#8a8f93'); fond.addColorStop(1, '#55595c');
    c.fillStyle = fond; c.fillRect(0, 0, 4000, 3000);
    c.fillStyle = '#2b2b2b'; c.beginPath(); c.ellipse(2000, 1600, 520, 300, 0.2, 0, 7); c.fill();
    c.fillStyle = '#ffffff'; c.font = 'bold 190px sans-serif'; c.fillText('IMAGE DE TEST', 1250, 500);
    return t.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await sol.locator('input[type=file]').setInputFiles({ name: 'sol.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(grande, 'base64') });
  await expect(sol.getByTestId('nb-photos')).toHaveText('1 photo');
  await chargee(page, sol.getByTestId('photos'));
  await sol.getByRole('button', { name: /^Photo du/ }).click();
  const visionneuse = page.getByRole('dialog', { name: 'Photo' });
  await expect(visionneuse).toContainText('Garage, Sol');
  await expect(visionneuse).toContainText('43.34420, 3.21580');
  await visionneuse.getByLabel('Légende').fill('Tache d’huile au centre');
  await visionneuse.getByText('Garage, Sol').click();
  if (captures) await page.screenshot({ path: `${captures}/19-photo.png` });
  await visionneuse.getByRole('button', { name: 'Fermer' }).click();

  // Un fichier qui n'est pas une image est refusé avec une explication.
  await sol.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('pas une image') });
  await expect(sol.getByRole('alert')).toContainText('n’a pas pu être lu');
  await expect(sol.getByTestId('nb-photos')).toHaveText('1 photo');

  // Le serveur a reçu la ligne ET le fichier, avec les éléments de preuve.
  await synchronise(page);
  const [largeur, hauteur, sha, lat, legende, chemin, recu] = sql(
    `select largeur, hauteur, length(sha256), round(latitude::numeric, 4), legende, storage_path, (recu_le is not null) from public.edl_photos p join public.edl e on e.id = p.edl_id join public.logements l on l.id = e.logement_id where l.libelle = 'ZZREC Garage photos' and p.legende is not null`,
  ).split('|');
  expect([largeur, hauteur]).toEqual(['1600', '1200']); // 4000 × 3000 réduite à 1600 × 1200
  expect([sha, lat, legende, recu]).toEqual(['64', '43.3442', 'Tache d’huile au centre', 't']);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'edl' and name = '${chemin}'`)).toBe('1');

  // ── Sans réseau : la photo est prise, visible, et survit au rechargement ──────
  await context.setOffline(true);
  await element(page, 'porte').getByRole('button', { name: 'Détail' }).click();
  const porte = element(page, 'porte');
  await porte.locator('input[type=file]').setInputFiles([await image(page, 'porte-1.png'), await image(page, 'porte-2.png')]);
  await expect(porte.getByTestId('nb-photos')).toHaveText('2 photos');
  await expect(page.getByTestId('hors-ligne')).toContainText('4 modifications gardées'); // 2 fichiers + 2 lignes
  await page.reload();
  await element(page, 'porte').getByRole('button', { name: 'Détail' }).click();
  await chargee(page, element(page, 'porte').getByTestId('photos'));
  await context.setOffline(false);
  await synchronise(page);
  await expect(page.getByTestId('rejets')).toHaveCount(0);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'edl' and name like '%/photos/%' and name like split_part('${chemin}', '/', 1) || '/%'`)).toBe('3');

  // ── Photo du compteur ──────────────────────────────────────────────────────
  // (un garage n'exige pas de compteur, mais l'écran reste accessible)
  await page.getByRole('link', { name: '← Toutes les pièces' }).click();
  await page.getByRole('link', { name: /Compteurs/ }).click();
  const elec = page.locator('section', { has: page.getByRole('heading', { name: 'Électricité' }) });
  await elec.locator('input[type=file]').setInputFiles(await image(page, 'compteur.png'));
  await chargee(page, elec.getByTestId('photos'));
  await synchronise(page);
  expect(sql(`select count(*) from public.edl_photos where compteur_type = 'electricite' and storage_path like split_part('${chemin}', '/', 1) || '/%'`)).toBe('1');

  // ── Un autre appareil, sans copie locale : la photo vient du serveur ──────────
  const autre = await browser.newContext();
  const p2 = await autre.newPage();
  await p2.goto('http://127.0.0.1:5173/connexion');
  await p2.getByLabel('Adresse e-mail').fill(email);
  await p2.getByLabel('Mot de passe').fill(MDP);
  await p2.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await p2.getByRole('link', { name: /ZZREC Garage photos/ }).click();
  await p2.getByRole('link', { name: /Garage/ }).first().click();
  await expect(element(p2, 'porte').getByTestId('nb-photos')).toHaveText('2 photos');
  await element(p2, 'sol').getByRole('button', { name: 'Détail' }).click();
  await chargee(p2, element(p2, 'sol').getByTestId('photos'));
  await autre.close();

  // ── Retrait : confirmé en deux temps, effacé aussi du serveur ─────────────────
  await retourPiece(page);
  await element(page, 'sol').getByRole('button', { name: 'Détail' }).click();
  await element(page, 'sol').getByRole('button', { name: /^Photo du/ }).click();
  await page.getByRole('button', { name: 'Retirer cette photo' }).click();
  await page.getByRole('button', { name: 'Confirmer : retirer définitivement cette photo' }).click();
  await expect(element(page, 'sol').getByTestId('nb-photos')).toHaveCount(0);
  await synchronise(page);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'edl' and name = '${chemin}'`)).toBe('0');
  expect(sql(`select count(*) from public.edl_photos where storage_path = '${chemin}'`)).toBe('0');

  // ── Verrou : sur un état des lieux signé, le stockage refuse tout nouveau fichier ─
  const [org, edl] = chemin.split('/');
  sql(`update public.edl set statut = 'signe', signe_le = now() where id = '${edl}'`);
  const refus = await page.evaluate(async ([o, e]) => {
    const jeton = JSON.parse(Object.entries(localStorage).find(([k]) => k.endsWith('-auth-token'))![1]).access_token;
    const r = await fetch(`/storage/v1/object/edl/${o}/${e}/photos/${crypto.randomUUID()}.jpg`, { method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'image/jpeg' }, body: new Blob(['x'], { type: 'image/jpeg' }) });
    return r.status;
  }, [org, edl]);
  expect(refus).toBeGreaterThanOrEqual(400);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'edl' and name like '${org}/${edl}/photos/%'`)).toBe('3');
});

async function retourPiece(page: Page) {
  await page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();
  await page.getByRole('link', { name: /Garage/ }).first().click();
}
