import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

// Le message « bail signé » est ici déposé directement dans la base locale, à la place de
// Signabail : ce parcours vérifie ce que le client voit ensuite, pas la liaison réseau.
const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const marque = Date.now();
const email = `zzrec-sb-${marque}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';

test('bail généré sur Signabail : crédit offert et brouillon pré-rempli', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByTestId('credits')).toHaveText('0 crédit');

  // Signabail envoie le message avant que le compte soit rattaché : il attend.
  const message = JSON.stringify({
    id: `signabail-bail-${marque}`, type: 'bail.genere', test: false, compte: { id: `sb-${marque}` },
    bail: {
      id: `bail-${marque}`, type: 'meuble', genere_le: new Date().toISOString(), signe_le: null, date_entree: '2026-12-01', depot_garantie: 650,
      logement: { adresse: '7 allées Paul-Riquet', code_postal: '34500', ville: 'Béziers', type_bien: 'appartement', surface_m2: 31, nb_pieces: 2, meuble: true },
      bailleur: { prenom: 'Claire', nom: 'ZZREC Vidal' }, co_bailleurs: [], mandataire: null,
      locataires: [{ prenom: 'Hugo', nom: 'ZZREC Marty', email: 'zzrec-hugo@constatio.test' }],
    },
  }).replace(/'/g, "''");
  expect(sql(`select public.signabail_recevoir('${message}'::jsonb)`)).toBe('en_attente');
  // Le client se connecte avec Signabail : le rattachement traite le message en attente.
  expect(sql(`select public.signabail_rattacher((select m.organisation_id from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${email}'), 'sb-${marque}')`)).toBe('1');

  await page.reload();
  await expect(page.getByTestId('credits')).toHaveText('1 crédit');
  const brouillon = page.getByRole('link', { name: /7 allées Paul-Riquet/ });
  await expect(brouillon).toContainText('offert avec votre bail Signabail');
  await brouillon.click();

  await expect(page.getByText('Pré-rempli depuis votre bail Signabail')).toBeVisible();
  await expect(page.getByText('Locataire : Hugo ZZREC Marty')).toBeVisible();
  // Signabail ne transmet que le nombre de pièces : le modèle T2 est posé, avec ses éléments.
  await expect(page.getByRole('listitem')).toHaveCount(7);
  await expect(page.getByTestId('avancement')).toContainText('0 élément sur 105');
  await expect(page.getByText('0 équipements obligatoires sur 11')).toBeVisible(); // meublé : inventaire exigé
  await page.getByRole('link', { name: /Salle de bain/ }).click();
  await expect(page.getByText('Douche et receveur')).toBeVisible();
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });

  // Rouvrir ne double pas la trame, et le serveur a bien reçu les éléments.
  await page.goto('/app');
  await page.getByRole('link', { name: /7 allées Paul-Riquet/ }).click();
  await expect(page.getByTestId('avancement')).toContainText('0 élément sur 105');
  expect(sql(`select count(*) from public.edl_elements el join public.edl e on e.id = el.edl_id where e.signabail_bail_id = 'bail-${marque}'`)).toBe('105');
});
