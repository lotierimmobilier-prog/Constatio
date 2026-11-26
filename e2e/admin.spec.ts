import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const marque = Date.now();
const client = `zzrec-client-${marque}@constatio.test`;
const admin = `zzrec-admin-${marque}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const photo = async (page: Page, nom: string) => { if (captures) await page.screenshot({ path: `${captures}/${nom}.png`, fullPage: true }); };

async function inscrire(page: Page, email: string, nom: string) {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.describe.configure({ mode: 'serial' });
// Quoi qu'il arrive dans ce fichier, la pile de test repart en mode test et au tarif d'origine.
test.afterAll(() => { sql(`update public.parametres set valeur = 'true' where cle = 'mode_test'; update public.tarifs set montant_cents = 1490 where code = 'edl_unite'`); });

test('un client n’entre pas dans l’administration', async ({ page }) => {
  await inscrire(page, client, `ZZREC Client ${marque}`);
  await page.goto('/app/compte');
  await expect(page.getByRole('link', { name: /administration/ })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toHaveText('Cette partie du site est réservée aux administrateurs de Constatio.');
  await page.goto('/admin/comptes');
  await expect(page.getByRole('alert')).toContainText('réservée aux administrateurs');
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('le super administrateur suit les comptes, offre des crédits, règle les tarifs et le mode test', async ({ page, browser }) => {
  await inscrire(page, admin, `ZZREC Admin ${marque}`);
  // Désignation au déploiement, par le serveur : aucune adresse n'est écrite dans le code.
  sql(`select public.admin_designer('${admin}', 'superadmin')`);
  await page.goto('/app/compte');
  await page.getByRole('link', { name: 'Ouvrir l’administration de Constatio' }).click();

  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByTestId('chiffres')).toContainText('Crédits en circulation');
  await expect(page.getByRole('status').filter({ hasText: 'Mode test actif' })).toBeVisible();
  await photo(page, '20-admin-tableau');

  // Comptes : recherche par adresse, puis geste commercial.
  await page.getByRole('link', { name: 'Comptes', exact: true }).click();
  await page.getByLabel('Rechercher par nom ou adresse e-mail').fill(client);
  await page.getByRole('button', { name: 'Chercher' }).click();
  await expect(page.getByRole('row')).toHaveCount(2); // l'en-tête et le compte trouvé
  await page.getByRole('link', { name: `ZZREC Client ${marque}` }).click();
  await expect(page.getByText(client)).toBeVisible();
  await page.getByRole('button', { name: 'Offrir' }).click();
  await expect(page.getByRole('alert')).toHaveText('Indiquez le motif du geste commercial.');
  await page.getByLabel('Nombre').fill('3');
  await page.getByLabel('Motif').fill('Geste après un incident de recette');
  await page.getByRole('button', { name: 'Offrir' }).click();
  await expect(page.getByRole('status')).toHaveText('3 crédits offerts, valables 24 mois.');
  await expect(page.getByText('3 / 3 · Geste commercial')).toBeVisible();
  await photo(page, '21-admin-compte');

  // Le client voit ses crédits.
  const autre = await browser.newContext();
  const p2 = await autre.newPage();
  await p2.goto('http://127.0.0.1:5173/connexion');
  await p2.getByLabel('Adresse e-mail').fill(client);
  await p2.getByLabel('Mot de passe').fill(MDP);
  await p2.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(p2.getByTestId('credits')).toHaveText('3 crédits');
  await autre.close();

  // Retrait du reste, confirmé en deux temps.
  await page.getByRole('button', { name: 'Retirer le reste' }).click();
  await page.getByRole('button', { name: 'Confirmer le retrait de 3 crédits' }).click();
  await expect(page.getByText('0 / 3 · Geste commercial')).toBeVisible();

  // Tarifs : une saisie invalide est expliquée, une modification est enregistrée.
  await page.getByRole('link', { name: 'Tarifs', exact: true }).click();
  const unite = page.getByTestId('tarif-edl_unite');
  await expect(unite.getByLabel('Prix TTC')).toHaveValue('14,90');
  await expect(unite.getByRole('button', { name: 'Enregistrer' })).toBeDisabled(); // rien n'a changé
  await unite.getByLabel('Prix TTC').fill('12,90');
  await unite.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'enregistré' })).toContainText('12,90');
  expect(sql(`select montant_cents from public.tarifs where code = 'edl_unite'`)).toBe('1290');
  await photo(page, '22-admin-tarifs');

  // Signabail et journal.
  await page.getByRole('link', { name: 'Signabail', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messages reçus de Signabail' })).toBeVisible();
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  // Le journal garde aussi les passages précédents : on regarde la ligne la plus récente.
  await expect(page.getByText('3 crédits · motif : Geste après un incident de recette').first()).toBeVisible();
  await expect(page.getByText(/edl_unite : 14,90\s€ → 12,90\s€/).first()).toBeVisible();
  await expect(page.locator('ol').getByText(admin).first()).toBeVisible(); // l'auteur de chaque action
  await photo(page, '23-admin-journal');

  // Réglages : couper le mode test demande de taper le mot, et se réactive d'un geste.
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  const couper = page.getByRole('button', { name: 'Couper le mode test' });
  await expect(couper).toBeDisabled();
  await page.getByLabel(/tapez PRODUCTION/).fill('PRODUCTION');
  await couper.click();
  await expect(page.getByRole('status').filter({ hasText: 'Le service est en production.' })).toBeVisible();
  expect(sql(`select valeur from public.parametres where cle = 'mode_test'`)).toBe('false');
  await page.getByRole('button', { name: 'Réactiver le mode test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mode test réactivé' })).toBeVisible();
  expect(sql(`select valeur from public.parametres where cle = 'mode_test'`)).toBe('true');

  // Clés Stripe : collées ici, jamais réaffichées ; une clé du mauvais monde est refusée.
  const cleTest = page.getByTestId('cle-stripe_cle_test');
  await cleTest.getByLabel('Clé secrète de test').fill('sk_live_abcdefghijklmnop0000');
  await cleTest.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'n\'a pas la forme attendue' })).toBeVisible();
  await cleTest.getByLabel('Clé secrète de test').fill('sk_test_abcdefghijklmnop4242');
  await cleTest.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(cleTest.getByText(/se termine par 4242/)).toBeVisible();
  await expect(cleTest.getByLabel('Clé secrète de test')).toHaveValue('');
  expect(await page.content()).not.toContain('abcdefghijklmnop');
  expect(sql(`select public.cles_stripe() ->> 'cle'`)).toBe('sk_test_abcdefghijklmnop4242');
  await expect(page.getByTestId('adresse-webhook')).toHaveText(/\/functions\/v1\/webhook-stripe$/);
  await cleTest.getByRole('button', { name: 'Effacer' }).click();
  await expect(cleTest.getByText('Non renseignée')).toBeVisible();

  // Administrateurs : nommer le client, puis lui retirer le rôle.
  await page.getByLabel('Adresse du compte à nommer').fill(client);
  await page.getByRole('button', { name: 'Nommer' }).click();
  await expect(page.getByText(`${client} · administrateur`)).toBeVisible();
  await photo(page, '24-admin-reglages');
  await page.getByRole('listitem').filter({ hasText: client }).getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText(`${client} · administrateur`)).toHaveCount(0);
  expect(sql(`select count(*) from public.administrateurs a join auth.users u on u.id = a.user_id where u.email = '${client}'`)).toBe('0');
});
