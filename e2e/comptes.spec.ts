import { expect, test } from '@playwright/test';

// Données de recette : préfixe ZZREC, adresse unique à chaque exécution.
const email = `zzrec-${Date.now()}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const photo = async (page: import('@playwright/test').Page, nom: string) => {
  if (captures) await page.screenshot({ path: `${captures}/${nom}.png`, fullPage: true });
};

test.describe.configure({ mode: 'serial' });

test('un visiteur est renvoyé vers la connexion', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/connexion$/);
  await photo(page, '2-connexion');
});

test('l’accueil annonce le mode test et les tarifs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Mode test')).toBeVisible();
  await expect(page.getByText('14,90 €')).toBeVisible();
  await photo(page, '1-accueil');
});

test('inscription : les erreurs sont expliquées', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByText('Indiquez votre nom.')).toBeVisible();
  await expect(page.getByText('Cette adresse e-mail n’est pas valide.')).toBeVisible();
  await expect(page.getByText('Vous devez accepter les conditions')).toBeVisible();
});

test('inscription d’une SCI, puis tableau de bord', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('SCI').check();
  await page.getByLabel('Prénom').fill('Claire');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await photo(page, '3-inscription');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Bonjour Claire' })).toBeVisible();
  await expect(page.getByTestId('credits')).toHaveText('0 crédit');
  await expect(page.getByText('Aucun état des lieux pour l’instant')).toBeVisible();
  await photo(page, '4-tableau-de-bord');
});

test('connexion refusée avec un mauvais mot de passe', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.');
});

test('une adresse déjà inscrite est signalée', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Doublon');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('alert')).toContainText('Un compte existe déjà');
});

test('connexion, compte, modification, déconnexion', async ({ page }) => {
  await page.goto('/app/compte');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  // Retour à la page demandée avant la connexion.
  await expect(page).toHaveURL(/\/app\/compte$/);
  await expect(page.getByText('Propriétaire du compte')).toBeVisible();
  // Le type choisi à l'inscription a créé une organisation « SCI ».
  await expect(page.getByLabel('Type de compte')).toHaveValue('sci');

  await page.getByLabel('Dénomination sociale').fill('ZZREC SCI des Balances');
  await page.getByLabel('SIRET').fill('123');
  await page.getByRole('button', { name: 'Enregistrer ces informations' }).click();
  await expect(page.getByText('Ce numéro SIRET n’est pas valide')).toBeVisible();
  await page.getByLabel('SIRET').fill('732 829 320 00074');
  await page.getByLabel('Adresse', { exact: true }).fill('12 rue des Balances');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByRole('button', { name: 'Enregistrer ces informations' }).click();
  await expect(page.getByText('Informations enregistrées.')).toBeVisible();
  await photo(page, '5-compte');

  await page.reload();
  await expect(page.getByLabel('Dénomination sociale')).toHaveValue('ZZREC SCI des Balances');
  await expect(page.getByLabel('SIRET')).toHaveValue('73282932000074');

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/connexion$/);
});

test('mot de passe oublié : même réponse que le compte existe ou non', async ({ page }) => {
  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill('zzrec-inconnu@constatio.test');
  await page.getByRole('button', { name: 'Recevoir le lien' }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte existe');
});

test('le lien reçu par e-mail permet de choisir un nouveau mot de passe', async ({ page, request }) => {
  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByRole('button', { name: 'Recevoir le lien' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  // L'e-mail arrive dans la boîte de test locale (Mailpit), jamais chez un vrai destinataire.
  const boite = 'http://127.0.0.1:54324/api/v1';
  let lien = '';
  await expect(async () => {
    const liste = await (await request.get(`${boite}/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const message = await (await request.get(`${boite}/message/${liste.messages[0].ID}`)).json();
    lien = /href="([^"]+)"/.exec(message.HTML)![1].replace(/&amp;/g, '&');
  }).toPass({ timeout: 10_000 });

  await page.goto(lien);
  await expect(page).toHaveURL(/\/nouveau-mot-de-passe/);
  await page.getByLabel('Nouveau mot de passe').fill('zzrec-nouveau-mdp-2');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/app$/);

  // L'ancien mot de passe ne fonctionne plus.
  await page.goto('/app/compte');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.');
});
