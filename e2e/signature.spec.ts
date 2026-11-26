import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-sig-${Date.now()}@constatio.test`;
const captures = process.env.CAPTURES;
const CLE = (readFileSync('.env.production.local', 'utf8').match(/VITE_SUPABASE_(?:ANON|PUBLISHABLE)_KEY=(.+)/) ?? [])[1]?.trim() ?? '';
const dossier = mkdtempSync(join(tmpdir(), 'cst-sig-'));
const texte = (fichier: string) => execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');

/** Trace une signature au doigt dans la zone prévue. */
async function tracer(page: Page) {
  const pad = page.getByTestId('pad');
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + b.height * 0.7);
  await page.mouse.down();
  for (const [dx, dy] of [[0.25, 0.2], [0.4, 0.8], [0.6, 0.25], [0.8, 0.7], [0.92, 0.4]]) await page.mouse.move(b.x + b.width * dx, b.y + b.height * dy, { steps: 6 });
  await page.mouse.up();
}

test('signature : sur place puis à distance, exemplaire signé et dossier de preuve', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('8 rue de la Signature');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage signature');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByTestId('reprendre')).toBeVisible();
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });

  const edl = page.url().match(/edl\/([0-9a-f-]{36})/)![1];
  const org = sql(`select organisation_id from public.edl where id = '${edl}'`);
  sql(`update public.edl_parties set adresse = '1 rue des Tests, 34500 Béziers' where edl_id = '${edl}' and role = 'bailleur';
       update public.edl_elements set etat = 'bon' where edl_id = '${edl}';
       insert into public.edl_parties (edl_id, role, civilite, prenom, nom, ordre) values ('${edl}', 'locataire', 'M.', 'Hugo', 'ZZREC Marty', 1);
       update public.edl_parties set email = case role when 'locataire' then 'hugo.marty@constatio.test' else 'bailleur.vidal@constatio.test' end where edl_id = '${edl}';
       insert into public.edl_cles (edl_id, nature, nombre, destination) values ('${edl}', 'cle', 1, 'Porte du garage');
       delete from public.credit_lots where organisation_id = '${org}';
       insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le) values ('${org}', 'geste_commercial', 1, 1, now() + interval '1 year');`);
  await page.goto(`/app/edl/${edl}/apercu`);
  await page.getByTestId('generer').click();
  await page.getByTestId('renonciation').check();
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Document généré.')).toBeVisible({ timeout: 60_000 });
  const empreinte = (await page.getByTestId('empreinte').innerText()).replace('Empreinte SHA-256 : ', '').trim();
  await expect(page.getByTestId('reste-signatures')).toContainText('2 signatures attendues');

  // ── Le bailleur signe sur place ────────────────────────────────────────────────
  const bailleur = page.getByTestId('signataire-bailleur');
  await bailleur.getByTestId('signer-ici').click();
  await expect(page.getByTestId('pad')).toHaveCount(0); // pas de signature sans avoir confirmé la lecture
  await bailleur.getByRole('checkbox').check();
  await expect(page.getByTestId('valider-signature')).toBeDisabled(); // ni sans tracé
  await tracer(page);
  if (captures) await page.screenshot({ path: `${captures}/26-signature-sur-place.png`, fullPage: true });
  await page.getByTestId('valider-signature').click();
  await expect(bailleur.getByText('Signé', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('reste-signatures')).toContainText('1 signature attendue');
  expect(sql(`select mode || ' ' || pdf_sha256 || ' ' || (ip is not null) from public.edl_signatures where edl_id = '${edl}'`)).toBe(`sur_place ${empreinte} true`);
  // Une signature est posée : plus de correction possible.
  await page.getByTestId('rouvrir').click();
  await expect(page.getByText(/Une partie a déjà signé/)).toBeVisible();

  // ── Le locataire signe à distance, sans compte ─────────────────────────────────
  const locataire = page.getByTestId('signataire-locataire');
  await locataire.getByTestId('creer-lien').click();
  const lien = (await page.getByTestId('lien-signature').innerText()).trim();
  expect(lien).toMatch(/^http:\/\/127\.0\.0\.1:5173\/signer\/[A-Za-z0-9_-]{40,}$/);
  // Seule l'empreinte du jeton est en base.
  expect(sql(`select count(*) from public.edl_jetons where edl_id = '${edl}' and jeton_hash = '${createHash('sha256').update(lien.split('/').pop()!).digest('hex')}'`)).toBe('1');

  const ailleurs = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ailleurs.newPage();
  await p2.goto('/signer/' + 'x'.repeat(43));
  await expect(p2.getByText(/Ce lien de signature n’est plus valable/)).toBeVisible();
  await p2.goto(lien);
  await expect(p2.getByTestId('signataire')).toHaveText('M. Hugo ZZREC Marty');
  await expect(p2.getByText('Mode test : cette signature est une démonstration, sans valeur.')).toBeVisible();
  await expect(p2.getByText('8 rue de la Signature, 34500 Béziers')).toBeVisible();
  // Le document proposé à la lecture est bien celui dont l'empreinte est annoncée.
  const aLire = await p2.request.get((await p2.getByTestId('lire-document').getAttribute('href'))!);
  expect(createHash('sha256').update(await aLire.body()).digest('hex')).toBe(empreinte);
  await p2.getByRole('checkbox').check();
  await tracer(p2);
  if (captures) await p2.screenshot({ path: `${captures}/27-signature-a-distance.png`, fullPage: true });
  await p2.getByTestId('valider-signature').click();
  await expect(p2.getByText(/Vous avez signé le/)).toBeVisible({ timeout: 60_000 });
  await expect(p2.getByText(/Toutes les parties ont signé/)).toBeVisible();
  await expect(p2.getByTestId('lire-document')).toHaveText('Ouvrir l’exemplaire signé');
  if (captures) await p2.screenshot({ path: `${captures}/28-signe-a-distance.png`, fullPage: true });
  await ailleurs.close();

  // ── Côté propriétaire : l'état des lieux est signé, l'exemplaire est là ────────────
  expect(sql(`select statut from public.edl where id = '${edl}'`)).toBe('signe');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Document signé', exact: true })).toBeVisible();
  const empreinteSigne = (await page.getByTestId('empreinte-signe').innerText()).replace('Empreinte SHA-256 : ', '').trim();
  const octets = await (await page.request.get((await page.getByTestId('ouvrir-signe').getAttribute('href'))!)).body();
  expect(createHash('sha256').update(octets).digest('hex')).toBe(empreinteSigne);
  const fichier = join(dossier, 'signe.pdf');
  writeFileSync(fichier, octets);
  if (captures) writeFileSync(`${captures}/signe.pdf`, octets);
  const t = texte(fichier);
  for (const attendu of ['Dossier de preuve des signatures', 'MODE TEST', empreinte, 'Bailleur — ZZREC Vidal', 'Locataire — M. Hugo ZZREC Marty', "Sur place, sur l'appareil", 'À distance, par lien personnel', 'Lu et approuvé — signé électroniquement'])
    expect(t, attendu).toContain(attendu);
  expect(sql(`select string_agg(evenement, ',' order by id) from public.edl_journal where edl_id = '${edl}' and evenement in ('signature', 'lien_cree', 'signe')`)).toBe('signature,lien_cree,signature,signe');
  // Le lien a servi : il ne signe plus rien.
  expect(sql(`select count(*) from public.edl_jetons where edl_id = '${edl}' and utilise_le is null`)).toBe('0');
  if (captures) await page.screenshot({ path: `${captures}/29-document-signe.png`, fullPage: true });

  // ── E-mails : à la signature, chaque partie reçoit le lien de son exemplaire ─────────────
  expect(sql(`select type || ' ' || (envoye_le is null) from public.courriels where edl_id = '${edl}'`)).toBe('document_signe true');
  await fetch('http://127.0.0.1:54324/api/v1/messages', { method: 'DELETE' });
  const expedier = async () => (await fetch('http://127.0.0.1:54321/functions/v1/courriel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-releve': sql('select public.cle_releve()') }, body: '{"action":"expedier"}' })).json();
  const boite = async (destinataire: string) => {
    const liste = (await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json()).messages as { ID: string; To: { Address: string }[]; Subject: string }[];
    const m = liste.find((x) => x.To[0].Address === destinataire);
    return m ? { sujet: m.Subject, ...((await (await fetch(`http://127.0.0.1:54324/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string; From: { Address: string; Name: string } }) } : null;
  };
  expect((await fetch('http://127.0.0.1:54321/functions/v1/courriel', { method: 'POST', headers: { 'x-releve': 'faux' }, body: '{}' })).status).toBe(401);
  // Mode test : rien ne part.
  expect(await expedier()).toMatchObject({ statut: 'ok', envoyes: 0 });
  expect(sql(`select note from public.courriels where edl_id = '${edl}'`)).toBe('retenu : mode test');
  expect(await boite('hugo.marty@constatio.test')).toBeNull();
  // Mode réel, boîte réglée : les deux parties reçoivent leur lien personnel.
  sql(`update public.parametres set valeur = 'false' where cle = 'mode_test';
       insert into private.cles_service (nom, valeur) values ('smtp_utilisateur', 'bonjour@constatio.test'), ('smtp_mot_de_passe', 'zzrec-boite-1'), ('smtp_hote', '127.0.0.1:54329') on conflict (nom) do update set valeur = excluded.valeur;
       update public.courriels set envoye_le = null, tentatives = 0, note = null where edl_id = '${edl}';`);
  try {
    expect(await expedier()).toMatchObject({ statut: 'ok', envoyes: 2, echecs: 0 });
    const recu = (await boite('hugo.marty@constatio.test'))!;
    expect(recu.sujet).toBe('Votre état des lieux d’entrée signé — 8 rue de la Signature, 34500 Béziers');
    expect(recu.From).toMatchObject({ Address: 'bonjour@constatio.test', Name: 'Constatio' });
    expect(recu.Text).toContain('Bonjour M. Hugo ZZREC Marty,');
    expect(recu.Text).toContain('Vous avez dix jours');
    const lienRecu = /http:\/\/127\.0\.0\.1:5173\/reserves\/[A-Za-z0-9_-]{40,}/.exec(recu.Text)![0];
    expect(recu.HTML).toContain(lienRecu);
    expect((await boite('bailleur.vidal@constatio.test'))!.Text).not.toContain('Vous avez dix jours');
    // Le lien reçu ouvre bien l'exemplaire signé, sans compte.
    const parMail = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p4 = await parMail.newPage();
    await p4.goto(lienRecu);
    await expect(p4.getByTestId('locataire')).toHaveText('M. Hugo ZZREC Marty');
    await expect(p4.getByTestId('document-signe')).toBeVisible();
    await expect(p4.getByLabel('Votre réserve')).toBeVisible();
    await parMail.close();
    // Rien ne repart une seconde fois.
    expect(await expedier()).toMatchObject({ traites: 0, envoyes: 0 });
  } finally {
    sql(`update public.parametres set valeur = 'true' where cle = 'mode_test'`);
  }

  // ── Réserves du locataire : dix jours pour compléter l'état des lieux d'entrée ────────
  await expect(page.getByTestId('delai-reserves')).toContainText('dix jours');
  await page.getByTestId('partie-lien').filter({ hasText: 'Marty' }).getByTestId('creer-lien-reserves').click();
  const lienReserves = (await page.getByTestId('lien-reserves').innerText()).trim();
  expect(lienReserves).toMatch(/\/reserves\/[A-Za-z0-9_-]{40,}$/);
  const chezLui = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await chezLui.newPage();
  await p3.goto('/reserves/' + 'x'.repeat(43));
  await expect(p3.getByText(/Ce lien n’est pas valable/)).toBeVisible();
  await p3.goto(lienReserves);
  await expect(p3.getByTestId('locataire')).toHaveText('M. Hugo ZZREC Marty');
  // Il retrouve d'abord son exemplaire signé.
  await expect(p3.getByTestId('document-signe')).toHaveAttribute('href', /\/storage\/v1\/object\/sign\/edl\/.+\.pdf\?token=/);
  const pieceChoisie = sql(`select nom from public.edl_pieces where edl_id = '${edl}' order by ordre, nom limit 1`);
  await p3.getByLabel('Pièce concernée').selectOption({ label: pieceChoisie });
  await p3.getByTestId('photos-reserve').setInputFiles({ name: 'fissure.png', mimeType: 'image/png', buffer: await p3.screenshot() });
  await expect(p3.getByTestId('photo-reserve')).toHaveCount(1);
  await p3.getByLabel('Votre réserve').fill('Fissure au plafond du garage, côté porte, non relevée.');
  await p3.getByRole('button', { name: 'Déposer cette réserve' }).click();
  await expect(p3.getByText(/Réserve enregistrée/)).toBeVisible();
  await expect(p3.getByTestId('ma-reserve')).toContainText('En attente de réponse');
  await expect(p3.getByTestId('ma-reserve')).toContainText(pieceChoisie);
  await expect.poll(() => p3.getByTestId('ma-reserve').locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
  expect(sql(`select cardinality(photo_paths) || ' ' || (piece_id is not null) from public.edl_complements where edl_id = '${edl}'`)).toBe('1 true');
  // Sans son lien, personne n'écrit dans ce dossier, et lui-même ne peut rien y lire.
  const hors = await p3.evaluate(async ([o, e, cle]) => {
    const depot = await fetch(`/storage/v1/object/edl/${o}/${e}/reserves/${'0'.repeat(64)}/${crypto.randomUUID()}.jpg`, { method: 'POST', headers: { apikey: cle, Authorization: `Bearer ${cle}`, 'Content-Type': 'image/jpeg' }, body: new Blob(['x'], { type: 'image/jpeg' }) });
    return depot.status;
  }, [org, edl, CLE] as const);
  expect(hors).toBeGreaterThanOrEqual(400);

  // Le bailleur la retrouve, y répond, et édite l'annexe.
  await page.reload();
  const reserve = page.getByTestId('reserve');
  await expect(reserve).toContainText('Fissure au plafond du garage');
  await expect(reserve).toContainText(pieceChoisie);
  await expect.poll(() => reserve.getByTestId('photo-reserve').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
  await reserve.getByLabel('Votre réponse').fill('Constaté sur place le lendemain.');
  await reserve.getByRole('button', { name: 'Accepter' }).click();
  await expect(reserve.getByText('Acceptée')).toBeVisible();
  const annexe = page.waitForEvent('download');
  await page.getByTestId('annexe-reserves').click();
  const fichierAnnexe = join(dossier, 'annexe.pdf');
  await (await annexe).saveAs(fichierAnnexe);
  const ta = texte(fichierAnnexe);
  for (const attendu of ['Annexe — réserves du locataire', '8 rue de la Signature, 34500 Béziers', 'Fissure au plafond du garage', pieceChoisie, '1 photo jointe par le locataire', 'acceptée — Constaté sur place le lendemain.', empreinteSigne]) expect(ta, attendu).toContain(attendu);
  expect(execFileSync('pdfimages', ['-list', fichierAnnexe], { encoding: 'utf8' }).trim().split('\n').length).toBe(3);
  if (captures) writeFileSync(`${captures}/annexe-reserves.pdf`, execFileSync('cat', [fichierAnnexe]));
  // E-mails de la réserve : le bailleur est prévenu du dépôt, le locataire de la réponse.
  expect(sql(`select string_agg(type, ',' order by cree_le) from public.courriels where edl_id = '${edl}' and envoye_le is null`)).toBe('reserve_deposee,reserve_repondue');
  sql(`update public.parametres set valeur = 'false' where cle = 'mode_test'`);
  try {
    await fetch('http://127.0.0.1:54324/api/v1/messages', { method: 'DELETE' });
    expect(await expedier()).toMatchObject({ statut: 'ok', envoyes: 2, echecs: 0 });
    const alerte = (await boite(email))!;
    expect(alerte.sujet).toBe('Réserve à valider — 8 rue de la Signature, 34500 Béziers');
    expect(alerte.Text).toContain('Fissure au plafond du garage');
    expect(alerte.Text).toContain(`/app/edl/${edl}/apercu`);
    const reponse = (await boite('hugo.marty@constatio.test'))!;
    expect(reponse.sujet).toContain('Réponse à votre réserve');
    expect(reponse.Text).toContain('acceptée');
    expect(reponse.Text).toContain('Constaté sur place le lendemain.');
  } finally {
    sql(`update public.parametres set valeur = 'true' where cle = 'mode_test'; delete from private.cles_service where nom like 'smtp_%'`);
  }
  // Le locataire lit la décision par son lien.
  await p3.reload();
  await expect(p3.getByTestId('ma-reserve')).toContainText('Acceptée');
  await expect(p3.getByTestId('ma-reserve')).toContainText('Constaté sur place le lendemain.');
  const annexeLocataire = p3.waitForEvent('download');
  await p3.getByTestId('annexe-reserves').click();
  const fichierLocataire = join(dossier, 'annexe-locataire.pdf');
  await (await annexeLocataire).saveAs(fichierLocataire);
  expect(texte(fichierLocataire)).toContain('acceptée — Constaté sur place le lendemain.');
  expect(execFileSync('pdfimages', ['-list', fichierLocataire], { encoding: 'utf8' }).trim().split('\n').length).toBe(3);
  if (captures) await p3.screenshot({ path: `${captures}/31-lien-document-locataire.png`, fullPage: true });

  // Le bailleur renvoie le document : son propre lien ne permet que de consulter, réserves comprises.
  await page.getByTestId('partie-lien').filter({ hasText: 'Vidal' }).getByTestId('creer-lien-reserves').click();
  const lienBailleur = (await page.getByTestId('partie-lien').filter({ hasText: 'Vidal' }).getByTestId('lien-reserves').innerText()).trim();
  await p3.goto(lienBailleur);
  await expect(p3.getByRole('heading', { name: 'Votre état des lieux signé' })).toBeVisible();
  await expect(p3.getByTestId('document-signe')).toBeVisible();
  await expect(p3.getByTestId('ma-reserve')).toContainText('Fissure au plafond du garage');
  await expect(p3.getByLabel('Votre réserve')).toHaveCount(0);
  if (captures) await page.screenshot({ path: `${captures}/30-remettre-document.png`, fullPage: true });
  await chezLui.close();
  expect(sql(`select string_agg(evenement, ',' order by id) from public.edl_journal where edl_id = '${edl}' and evenement like 'reserve%'`)).toBe('reserves_lien_cree,reserve_deposee,reserve_repondue,reserves_lien_cree');
});
