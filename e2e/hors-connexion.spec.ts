import { expect, test, type Page } from '@playwright/test';

const email = `zzrec-hc-${Date.now()}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const photo = async (page: Page, nom: string) => {
  if (captures) await page.screenshot({ path: `${captures}/${nom}.png` });
};
const element = (page: Page, categorie: string) => page.getByTestId(`element-${categorie}`).first();

test('une visite entière sans réseau, puis synchronisation au retour', async ({ page, context, browser }) => {
  // En ligne : compte et état des lieux.
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Studio', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('2 rue de la Cave');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Sous-sol');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByRole('heading', { name: 'ZZREC Sous-sol' })).toBeVisible();
  await expect(page.getByTestId('envoi')).toHaveCount(0); // tout est parti au serveur
  // L'application est en cache : elle pourra se rouvrir sans réseau.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  // ── Le réseau disparaît ────────────────────────────────────────────────────
  await context.setOffline(true);
  await expect(page.getByTestId('hors-ligne')).toContainText('Hors connexion');

  await page.getByRole('link', { name: /Pièce principale/ }).click();
  await element(page, 'sol').getByRole('button', { name: 'Bon état' }).click();
  await element(page, 'murs').getByRole('button', { name: 'Mauvais état' }).click();
  await element(page, 'murs').getByRole('button', { name: 'Détail' }).click();
  await page.getByLabel('Observations', { exact: true }).fill('Traces d’humidité sous la fenêtre');
  await page.getByLabel('Observations sur la pièce').click();
  await expect(page.getByTestId('hors-ligne')).toContainText('3 modifications gardées sur cet appareil');
  await photo(page, '16-hors-connexion');

  await page.getByRole('link', { name: '← Toutes les pièces' }).click();
  await expect(page.getByTestId('avancement')).toContainText('2 éléments sur');
  await page.getByRole('link', { name: /Compteurs/ }).click();
  await page.getByLabel('Pas de gaz dans le logement').check();
  await page.getByRole('link', { name: 'Continuer : remise des clés' }).click();
  await page.getByRole('button', { name: '+ Cave' }).click();
  await expect(page.getByTestId('total-cles')).toHaveText('1 élément remis');
  await expect(page.getByTestId('hors-ligne')).toContainText('5 modifications gardées');

  // Recharger la page sans réseau : l'application s'ouvre et rien n'est perdu.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clés et accès' })).toBeVisible();
  await expect(page.getByTestId('total-cles')).toHaveText('1 élément remis');
  await page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();
  await expect(page.getByTestId('avancement')).toContainText('1 à signaler');

  // Créer un second état des lieux sans réseau.
  await page.getByRole('link', { name: '← Mes états des lieux' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('2 rue de la Cave');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Box 12');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByRole('heading', { name: 'ZZREC Box 12' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('link', { name: '← Mes états des lieux' }).click();
  await expect(page.getByRole('link', { name: /ZZREC/ })).toHaveCount(2);
  await photo(page, '17-liste-hors-connexion');

  // ── Le réseau revient ──────────────────────────────────────────────────────
  await context.setOffline(false);
  await expect(page.getByTestId('hors-ligne')).toHaveCount(0);
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('rejets')).toHaveCount(0);

  // Preuve que le serveur a tout reçu : un autre appareil, sans aucune copie locale.
  const autre = await browser.newContext();
  const p2 = await autre.newPage();
  await p2.goto('http://127.0.0.1:5173/connexion');
  await p2.getByLabel('Adresse e-mail').fill(email);
  await p2.getByLabel('Mot de passe').fill(MDP);
  await p2.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(p2.getByRole('link', { name: /ZZREC/ })).toHaveCount(2);
  await p2.getByRole('link', { name: /ZZREC Sous-sol/ }).click();
  await expect(p2.getByTestId('avancement')).toContainText('2 éléments sur');
  await expect(p2.getByText('1 remis')).toBeVisible();
  await p2.getByRole('link', { name: /Pièce principale/ }).click();
  await expect(element(p2, 'murs').getByRole('button', { name: 'Mauvais état' })).toHaveAttribute('aria-pressed', 'true');
  await element(p2, 'murs').getByRole('button', { name: 'Note ✓' }).click();
  await expect(p2.getByLabel('Observations', { exact: true })).toHaveValue('Traces d’humidité sous la fenêtre');
  await autre.close();
});

test('se déconnecter avec des saisies non envoyées demande confirmation', async ({ page, context }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('link', { name: /ZZREC Sous-sol/ }).click();
  await expect(page.getByRole('heading', { name: 'ZZREC Sous-sol' })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Remarques générales').fill('Saisie hors connexion');
  await page.getByRole('heading', { name: 'Pièces' }).click();
  await expect(page.getByTestId('hors-ligne')).toContainText('1 modification gardée');
  await page.getByRole('link', { name: 'Compte', exact: true }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('alert')).toContainText('n’est pas encore envoyée');
  await expect(page.getByRole('button', { name: 'Me déconnecter quand même' })).toBeVisible();
  // On ne se déconnecte pas : au retour du réseau, la saisie part.
  await context.setOffline(false);
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('link', { name: 'États des lieux' }).click();
  await page.getByRole('link', { name: /ZZREC Sous-sol/ }).click();
  await page.reload();
  await expect(page.getByLabel('Remarques générales')).toHaveValue('Saisie hors connexion');
});
