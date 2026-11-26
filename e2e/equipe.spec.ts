import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const instant = Date.now();
const admin = `zzrec-agence-${instant}@constatio.test`;
const commercial = `zzrec-commercial-${instant}@constatio.test`;

async function inscrire(page: Page, nom: string, email: string) {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
}

test('équipe : un commercial invité saisit des états des lieux, sans facturation, avec les droits que l’agence lui donne', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await inscrire(page, 'ZZREC Agence', admin);
  await expect(page).toHaveURL(/\/app$/);
  const org = sql(`select m.organisation_id from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${admin}'`);

  // Compte de particulier : pas d'équipe.
  await page.goto('/app/compte');
  await expect(page.getByRole('heading', { name: 'Équipe' })).toHaveCount(0);
  sql(`update public.organisations set type = 'pro', nom = 'ZZREC Agence du Canal' where id = '${org}'`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Équipe' })).toBeVisible();
  await expect(page.getByTestId('membre-proprietaire')).toContainText(admin);

  // L'administrateur invite : le collaborateur ne pourra pas générer de document.
  await page.getByLabel('Prénom et nom').fill('ZZREC Paul Durand');
  const formulaire = page.locator('form', { has: page.getByLabel('Prénom et nom') });
  await formulaire.getByLabel(/Générer les documents/).uncheck();
  await page.getByRole('button', { name: 'Créer le lien d’invitation' }).click();
  const lien = (await page.getByTestId('lien-invitation').innerText()).trim();
  expect(lien).toMatch(/\/rejoindre\/[A-Za-z0-9_-]{40,}$/);
  // Seule l'empreinte du lien est en base.
  expect(sql(`select count(*) from public.organisation_invitations where organisation_id = '${org}' and jeton_hash ~ '^[0-9a-f]{64}$'`)).toBe('1');

  // ── Le commercial, sur son propre appareil ─────────────────────────────────────
  const ailleurs = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ailleurs.newPage();
  await p2.goto(lien);
  await expect(p2.getByRole('heading', { name: 'Rejoindre ZZREC Agence du Canal' })).toBeVisible();
  await p2.getByRole('link', { name: 'Créer mon identifiant' }).click();
  await inscrire(p2, 'ZZREC Paul Durand', commercial);
  // Son compte créé, il est ramené à l'invitation.
  await p2.getByTestId('rejoindre').click({ timeout: 20_000 });
  await expect(p2).toHaveURL(/\/app$/);
  expect(sql(`select m.role || ' ' || (m.droits ->> 'generer') from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${commercial}' and m.organisation_id = '${org}'`)).toBe('agent false');
  // Pas de facturation : ni lien vers les crédits, ni page.
  await expect(p2.getByTestId('credits')).toHaveCount(0);
  await p2.goto('/app/credits');
  await expect(p2.getByText(/gérés par l’administrateur de votre compte/)).toBeVisible();
  // Pas d'équipe ni de réglages du compte.
  await p2.goto('/app/compte');
  await expect(p2.getByRole('heading', { name: 'Équipe' })).toHaveCount(0);
  // Il saisit un état des lieux pour l'agence.
  await p2.goto('/app/edl/nouveau');
  await p2.getByText('Garage / parking', { exact: true }).click();
  await p2.getByLabel('Adresse', { exact: true }).fill('7 quai du Commerce');
  await p2.getByLabel('Code postal').fill('34500');
  await p2.getByLabel('Ville').fill('Béziers');
  await p2.getByLabel('Nom du logement').fill('ZZREC Garage équipe');
  await p2.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(p2.getByTestId('reprendre')).toBeVisible();
  await expect(p2.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  expect(sql(`select count(*) from public.edl where organisation_id = '${org}'`)).toBe('1');
  await ailleurs.close();

  // ── L'administrateur retrouve son collaborateur et son travail ──────────────────────
  await page.reload();
  const membre = page.getByTestId('membre-agent');
  await expect(membre).toContainText(commercial);
  await expect(membre).toContainText('1 état des lieux');
  await membre.getByLabel(/Générer les documents/).click(); // la case suit la base : elle se coche une fois le droit enregistré
  await expect.poll(() => sql(`select m.droits ->> 'generer' from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${commercial}'`)).toBe('true');
  await page.goto('/app');
  await expect(page.getByRole('link', { name: /ZZREC Garage équipe/ })).toBeVisible();
  // Retiré de l'équipe : ses états des lieux restent à l'agence.
  await page.goto('/app/compte');
  await page.getByTestId('membre-agent').getByRole('button', { name: 'Retirer de l’équipe' }).click();
  await expect(page.getByTestId('membre-agent')).toHaveCount(0);
  expect(sql(`select count(*) from public.edl where organisation_id = '${org}'`)).toBe('1');
});
