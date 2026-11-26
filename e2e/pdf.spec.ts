import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-pdf-${Date.now()}@constatio.test`;
const captures = process.env.CAPTURES;
const dossier = mkdtempSync(join(tmpdir(), 'cst-pdf-'));
/** Le texte d'un PDF, tel qu'un lecteur le voit. */
const texte = (fichier: string) => execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');

test.use({ permissions: ['geolocation'], geolocation: { latitude: 43.3442, longitude: 3.2158 }, acceptDownloads: true });

test('document : aperçu gratuit, génération payée par un crédit, verrou, réouverture', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('3 quai Vallière');
  await page.getByLabel('Code postal').fill('11100');
  await page.getByLabel('Ville').fill('Narbonne');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage document');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('reprendre').click();

  // Une vraie photo, prise dans l'application.
  const sol = page.getByTestId('element-sol').first();
  await sol.getByRole('button', { name: 'Détail' }).click();
  const image = await page.evaluate(() => {
    const t = document.createElement('canvas'); t.width = 1200; t.height = 900;
    const c = t.getContext('2d')!; c.fillStyle = '#6d7377'; c.fillRect(0, 0, 1200, 900);
    c.fillStyle = '#fff'; c.font = 'bold 90px sans-serif'; c.fillText('SOL DU GARAGE', 220, 450);
    return t.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await sol.locator('input[type=file]').setInputFiles({ name: 'sol.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(image, 'base64') });
  await expect(sol.getByTestId('nb-photos')).toHaveText('1 photo');
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });

  // Le reste de la visite est saisi directement en base : ce test porte sur le document.
  const edl = page.url().match(/edl\/([0-9a-f-]{36})/)![1];
  const org = sql(`select organisation_id from public.edl where id = '${edl}'`);
  sql(`update public.edl_parties set adresse = '1 rue des Tests, 34500 Béziers' where edl_id = '${edl}' and role = 'bailleur';
       update public.edl_elements set etat = 'bon', observations = case when libelle = 'Sol' then 'Tache d''huile au centre' end where edl_id = '${edl}';
       insert into public.edl_parties (edl_id, role, civilite, prenom, nom, email) values ('${edl}', 'locataire', 'M.', 'Hugo', 'ZZREC Marty', 'hugo@constatio.test');
       insert into public.edl_cles (edl_id, nature, nombre, destination) values ('${edl}', 'telecommande', 2, 'Porte du garage');
       delete from public.credit_lots where organisation_id = '${org}';`);
  await page.goto(`/app/edl/${edl}`);
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : tout est complet');

  // ── Aperçu : gratuit, marqué sans valeur ───────────────────────────────────────
  await page.getByTestId('lien-apercu').click();
  const telechargement = page.waitForEvent('download');
  await page.getByTestId('telecharger-apercu').click();
  const apercu = join(dossier, 'apercu.pdf');
  await (await telechargement).saveAs(apercu);
  const ta = texte(apercu);
  for (const attendu of ['APERÇU SANS VALEUR', "ÉTAT DES LIEUX D'ENTRÉE", '3 quai Vallière, 11100 Narbonne', 'M. Hugo ZZREC Marty', 'Télécommande', 'Porte du garage', "Tache d'huile au centre", 'Photo 1 — Garage, Sol', '43.34420, 3.21580', 'Lu et approuvé'])
    expect(ta, attendu).toContain(attendu);
  expect(sql(`select statut from public.edl where id = '${edl}'`)).toBe('brouillon');
  if (captures) await page.screenshot({ path: `${captures}/24-apercu.png`, fullPage: true });

  // ── Sans crédit : refus net, rien n'est figé ───────────────────────────────────
  await page.getByTestId('generer').click();
  await expect(page.getByText('La génération utilise 1 crédit.')).toBeVisible();
  // Pas de génération sans demande expresse et renonciation à la rétractation pour ce crédit.
  await expect(page.getByTestId('confirmer-generation')).toBeDisabled();
  await page.getByTestId('renonciation').check();
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Aucun crédit disponible pour ce document. Rien n’a été débité.')).toBeVisible({ timeout: 30_000 });
  expect(sql(`select statut from public.edl where id = '${edl}'`)).toBe('brouillon');

  // ── Avec un crédit : document définitif, empreinte conservée ───────────────────
  sql(`insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le) values ('${org}', 'geste_commercial', 1, 1, now() + interval '1 year')`);
  await page.getByTestId('generer').click();
  await page.getByTestId('renonciation').check();
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Document généré.')).toBeVisible({ timeout: 60_000 });
  const empreinte = (await page.getByTestId('empreinte').innerText()).replace('Empreinte SHA-256 : ', '').trim();
  expect(sql(`select statut || ' ' || pdf_sha256 || ' ' || credit_consomme from public.edl where id = '${edl}'`)).toBe(`termine ${empreinte} true`);
  expect(sql(`select restant from public.credit_lots where organisation_id = '${org}'`)).toBe('0');
  expect(sql(`select string_agg(evenement, ',' order by id) from public.edl_journal where edl_id = '${edl}' and evenement in ('finalise', 'pdf_genere')`)).toBe('finalise,pdf_genere');
  const reponse = await page.request.get((await page.getByTestId('ouvrir-document').getAttribute('href'))!);
  const octets = await reponse.body();
  // Le fichier servi est exactement celui dont l'empreinte est conservée.
  expect(createHash('sha256').update(octets).digest('hex')).toBe(empreinte);
  const definitif = join(dossier, 'definitif.pdf');
  writeFileSync(definitif, octets);
  const td = texte(definitif);
  expect(td).not.toContain('APERÇU');
  for (const attendu of ['3 quai Vallière, 11100 Narbonne', 'Photo 1 — Garage, Sol', 'Réalisé avec Constatio — partenaire Signabail']) expect(td, attendu).toContain(attendu);
  expect(td).not.toContain('Photo indisponible');
  if (captures) { await page.screenshot({ path: `${captures}/25-document.png`, fullPage: true }); writeFileSync(`${captures}/definitif.pdf`, readFileSync(definitif)); }

  // ── Terminé = figé, y compris pour qui contournerait l'écran ───────────────────
  await page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();
  await expect(page.getByTestId('lien-document')).toBeVisible();
  await expect(page.getByLabel('Remarques générales')).toBeDisabled();
  const jeton = await page.evaluate(() => { const c = Object.keys(localStorage).find((k) => k.includes('auth-token'))!; return JSON.parse(localStorage.getItem(c)!).access_token as string; });
  const cle = readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)![1].trim();
  const entetes = { Authorization: `Bearer ${jeton}`, apikey: cle, Prefer: 'return=representation' };
  // La même demande passe en lecture : c'est bien l'écriture qui est refusée, pas la session.
  expect((await (await page.request.get(`/rest/v1/edl_elements?edl_id=eq.${edl}&select=id`, { headers: entetes })).json()).length).toBeGreaterThan(0);
  const tentative = await page.request.patch(`/rest/v1/edl_elements?edl_id=eq.${edl}`, { headers: entetes, data: { etat: 'mauvais' } });
  expect(await tentative.json(), 'aucune ligne modifiée').toEqual([]);
  expect(sql(`select count(*) from public.edl_elements where edl_id = '${edl}' and etat = 'mauvais'`), `réponse ${tentative.status()}`).toBe('0');

  // ── Rouvrir, corriger, régénérer : sans nouveau crédit ─────────────────────────
  await page.getByTestId('lien-document').click();
  await page.getByTestId('rouvrir').click();
  await expect(page.getByTestId('generer')).toBeVisible();
  expect(sql(`select statut || ' ' || coalesce(pdf_sha256, 'aucune') from public.edl where id = '${edl}'`)).toBe('brouillon aucune');
  await page.getByTestId('generer').click();
  await expect(page.getByText('Ce document a déjà été réglé : le régénérer ne coûte rien.')).toBeVisible();
  await expect(page.getByTestId('renonciation')).toHaveCount(0); // déjà réglé : plus rien à quoi renoncer
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Document généré.')).toBeVisible({ timeout: 60_000 });
  expect(sql(`select statut from public.edl where id = '${edl}'`)).toBe('termine');
  expect(sql(`select count(*) from public.credit_consommations where edl_id = '${edl}'`)).toBe('1');
});
