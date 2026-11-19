import { expect, test, type Page } from '@playwright/test';

const email = `zzrec-gestes-${Date.now()}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const element = (page: Page, categorie: string) => page.getByTestId(`element-${categorie}`).first();

test.describe.configure({ mode: 'serial' });
test.afterEach(async ({ page }) => {
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });
});

test('gestes rapides : phrases types, essai sur place, duplication, solde de la pièce', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('9 rue du Port');
  await page.getByLabel('Code postal').fill('11100');
  await page.getByLabel('Ville').fill('Narbonne');
  await page.getByLabel('Nom du logement').fill('ZZREC Box');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();

  // La vue d'ensemble propose de commencer par la première pièce à faire.
  await page.getByTestId('reprendre').click();
  await expect(page.getByRole('heading', { name: 'Garage' })).toBeVisible();

  // On note d'abord le défaut, avec une phrase type et l'essai sur place.
  await element(page, 'porte').getByRole('button', { name: 'Mauvais état', exact: true }).click();
  await element(page, 'porte').getByRole('button', { name: 'Détail' }).click();
  await page.getByRole('button', { name: 'Serrure dure' }).click();
  await page.getByRole('button', { name: 'Frotte à la fermeture' }).click();
  await expect(page.getByLabel('Observations', { exact: true })).toHaveValue('Serrure dure. Frotte à la fermeture.');
  await page.getByRole('button', { name: 'Ne fonctionne pas' }).click();
  await expect(element(page, 'porte')).toContainText('Ne fonctionne pas');

  // Une seconde porte : dupliquée, vierge.
  await page.getByRole('button', { name: 'Dupliquer' }).click();
  await expect(page.getByText('Porte / accès 2')).toBeVisible();

  // Puis on solde le reste d'un geste : seuls les éléments sans état sont touchés.
  if (captures) await page.screenshot({ path: `${captures}/18-gestes.png` });
  await page.getByRole('button', { name: /Le reste est en bon état \(3 éléments\)/ }).click();
  await expect(page.getByRole('button', { name: /Le reste est en bon état/ })).toHaveCount(0);
  await expect(element(page, 'porte').getByRole('button', { name: 'Mauvais état', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, 'sol').getByRole('button', { name: 'Bon état', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(element(page, 'porte')).toContainText('Ne fonctionne pas');
  await page.getByRole('link', { name: /Dernière pièce/ }).click();
  await expect(page.getByTestId('avancement')).toContainText('4 éléments sur 4');
  await expect(page.getByTestId('reprendre')).toHaveCount(0); // tout est fait
});

test('sortie : « inchangé depuis l’entrée » reprend états et remarques', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByLabel(/^Sortie/).check();
  await page.getByLabel('État des lieux d’entrée', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('reprendre').click();

  // Le sol a été abîmé depuis l'entrée : on le note, puis on reprend le reste tel quel.
  await element(page, 'sol').getByRole('button', { name: 'Mauvais état', exact: true }).click();
  await page.getByRole('button', { name: /Inchangé depuis l’entrée : reprendre les 3 éléments restants/ }).click();
  await expect(page.getByRole('button', { name: /Inchangé depuis l’entrée/ })).toHaveCount(0);
  await expect(element(page, 'sol').getByRole('button', { name: 'Mauvais état', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, 'porte').getByRole('button', { name: 'Mauvais état', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, 'porte')).toContainText('Ne fonctionne pas');
  await element(page, 'porte').getByRole('button', { name: 'Note ✓' }).click();
  await expect(page.getByLabel('Observations', { exact: true })).toHaveValue('Serrure dure. Frotte à la fermeture.');
  await expect(element(page, 'electricite').getByRole('button', { name: 'Bon état', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
