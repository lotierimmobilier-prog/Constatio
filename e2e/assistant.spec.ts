import { expect, test } from '@playwright/test';

test('assistant : répond sur le fonctionnement et la réglementation, et sait dire qu’il ne sait pas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('bulle-assistant').click();
  const panneau = page.getByTestId('assistant');
  await expect(panneau.getByText('Bonjour, je suis Constant.', { exact: false })).toBeVisible();

  // Une idée proposée d'un geste.
  await panneau.getByRole('button', { name: 'Combien ça coûte ?' }).click();
  await expect(panneau.getByTestId('reponse').last()).toContainText('14,90 €');

  // Une question réglementaire, tournée à sa façon : la réponse vient d'un guide.
  await panneau.getByLabel('Votre question').fill('sous combien de temps je dois rendre le dépôt de garantie ?');
  await panneau.getByRole('button', { name: 'Envoyer' }).click();
  await expect(panneau.getByTestId('reponse').last()).toContainText(/un mois|deux mois/i);

  // Hors sujet : pas de réponse inventée.
  await panneau.getByLabel('Votre question').fill('quelle est la capitale du Pérou');
  await panneau.getByLabel('Votre question').press('Enter');
  await expect(panneau.getByTestId('reponse').last()).toContainText('je préfère ne pas en inventer');
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/33-assistant.png` });

  await page.keyboard.press('Escape');
  await expect(panneau).toHaveCount(0);
  // Absent de la page où une partie signe.
  await page.goto('/signer/' + 'x'.repeat(43));
  await expect(page.getByTestId('bulle-assistant')).toHaveCount(0);
});
