import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-pres-${Date.now()}@constatio.test`;
const captures = process.env.CAPTURES;
const dossier = mkdtempSync(join(tmpdir(), 'cst-pres-'));
const texte = (fichier: string) => execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
/** Nombre d'images contenues dans un PDF. */
const images = (fichier: string) => execFileSync('pdfimages', ['-list', fichier], { encoding: 'utf8' }).trim().split('\n').length - 2;

test.use({ acceptDownloads: true });

test('présentation : logo du compte professionnel et filigrane sur les photos, dans l’aperçu et le document', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/app$/);
  const org = sql(`select m.organisation_id from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${email}'`);

  // Compte de particulier : le logo n'est pas proposé.
  await page.goto('/app/compte');
  await expect(page.getByText(/Réservé aux comptes professionnels/)).toBeVisible();
  await expect(page.getByTestId('choisir-logo')).toHaveCount(0);

  // Compte professionnel : dépôt du logo et réglage du filigrane.
  sql(`update public.organisations set type = 'pro', nom = 'ZZREC Cabinet Vidal' where id = '${org}'`);
  await page.reload();
  const logo = await page.evaluate(() => {
    const t = document.createElement('canvas'); t.width = 1600; t.height = 500;
    const c = t.getContext('2d')!; c.fillStyle = '#0f4c4a'; c.fillRect(0, 0, 1600, 500);
    c.fillStyle = '#f4b61a'; c.font = 'bold 220px sans-serif'; c.fillText('ZZREC', 420, 330);
    return t.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.getByTestId('choisir-logo').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(logo, 'base64') });
  await expect(page.getByText('Logo enregistré.', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('logo')).toBeVisible();
  // Réduit avant l'envoi, et rangé dans le dossier du compte.
  expect(sql(`select logo_path like '${org}/logo-%.png' from public.organisations where id = '${org}'`)).toBe('t');
  expect(Number(sql(`select (metadata->>'size')::int from storage.objects where bucket_id = 'marque' and name = (select logo_path from public.organisations where id = '${org}')`))).toBeLessThan(200_000);
  await expect(page.getByTestId('logo-joint')).toContainText('Logo joint');
  // Réglages enregistrés d'eux-mêmes, sans bouton.
  await page.getByLabel(/Filigrane sur les photos/).check();
  await page.getByLabel('Texte du filigrane').fill('Cabinet ZZREC');
  await expect.poll(() => sql(`select filigrane_photos || ' ' || coalesce(filigrane_texte, '') from public.organisations where id = '${org}'`), { timeout: 10_000 }).toBe('true Cabinet ZZREC');
  await expect(page.getByTestId('etat-presentation')).toContainText('Enregistré');
  // Image de filigrane : un JPEG ou une image sans transparence sont refusés, avec l'explication.
  const opaque = await page.evaluate(() => { const t = document.createElement('canvas'); t.width = 800; t.height = 300; const c = t.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, 800, 300); return t.toDataURL('image/png').split(',')[1]; });
  await page.getByTestId('choisir-filigrane').setInputFiles({ name: 'opaque.png', mimeType: 'image/png', buffer: Buffer.from(opaque, 'base64') });
  await expect(page.getByText(/n’a pas de fond transparent/)).toBeVisible();
  const transparent = await page.evaluate(() => { const t = document.createElement('canvas'); t.width = 1600; t.height = 500; const c = t.getContext('2d')!; c.fillStyle = '#0f2e2e'; c.font = 'bold 300px sans-serif'; c.fillText('ZZREC', 250, 360); return t.toDataURL('image/png').split(',')[1]; });
  await page.getByTestId('choisir-filigrane').setInputFiles({ name: 'filigrane.png', mimeType: 'image/png', buffer: Buffer.from(transparent, 'base64') });
  await expect(page.getByTestId('filigrane-image-joint')).toContainText('Image de filigrane jointe', { timeout: 20_000 });
  expect(sql(`select filigrane_image_path like '${org}/filigrane-%.png' from public.organisations where id = '${org}'`)).toBe('t');
  if (captures) await page.screenshot({ path: `${captures}/32-presentation.png`, fullPage: true });

  // Un état des lieux avec une photo.
  await page.goto('/app/edl/nouveau');
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('5 rue du Logo');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage présentation');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('reprendre').click();
  const sol = page.getByTestId('element-sol').first();
  await sol.getByRole('button', { name: 'Détail' }).click();
  const photo = await page.evaluate(() => {
    const t = document.createElement('canvas'); t.width = 1200; t.height = 900;
    const c = t.getContext('2d')!; const f = c.createLinearGradient(0, 0, 1200, 900); f.addColorStop(0, '#9aa3a8'); f.addColorStop(1, '#4d5458');
    c.fillStyle = f; c.fillRect(0, 0, 1200, 900);
    return t.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await sol.locator('input[type=file]').setInputFiles({ name: 'sol.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64') });
  await expect(sol.getByTestId('nb-photos')).toHaveText('1 photo');
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  const edl = page.url().match(/edl\/([0-9a-f-]{36})/)![1];
  sql(`update public.edl_parties set adresse = '1 rue des Tests, 34500 Béziers' where edl_id = '${edl}' and role = 'bailleur';
       update public.edl_elements set etat = 'bon' where edl_id = '${edl}';
       insert into public.edl_parties (edl_id, role, prenom, nom) values ('${edl}', 'locataire', 'Hugo', 'ZZREC Marty');
       insert into public.edl_cles (edl_id, nature, nombre, destination) values ('${edl}', 'cle', 1, 'Porte du garage');
       delete from public.credit_lots where organisation_id = '${org}';
       insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le) values ('${org}', 'geste_commercial', 1, 1, now() + interval '1 year');`);

  // ── Aperçu, construit sur l'appareil ───────────────────────────────────────────
  await page.goto(`/app/edl/${edl}/apercu`);
  const telechargement = page.waitForEvent('download');
  await page.getByTestId('telecharger-apercu').click();
  const apercu = join(dossier, 'apercu.pdf');
  await (await telechargement).saveAs(apercu);
  expect(texte(apercu)).toMatch(/Cabinet ZZREC · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  expect(images(apercu), 'la photo, le logo, l’image de filigrane et le logo Constatio de l’aperçu (ces deux derniers avec leur transparence)').toBe(6);

  // ── Document définitif, construit par le serveur ───────────────────────────────
  await page.getByTestId('generer').click();
  await page.getByTestId('renonciation').check();
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Document généré.')).toBeVisible({ timeout: 60_000 });
  const definitif = join(dossier, 'definitif.pdf');
  writeFileSync(definitif, await (await page.request.get((await page.getByTestId('ouvrir-document').getAttribute('href'))!)).body());
  if (captures) writeFileSync(`${captures}/presentation.pdf`, execFileSync('cat', [definitif]));
  expect(texte(definitif)).toMatch(/Cabinet ZZREC · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  expect(texte(definitif)).toContain('ZZREC Cabinet Vidal');
  expect(images(definitif), 'la photo, le logo, l’image de filigrane et sa transparence').toBe(4);
});
