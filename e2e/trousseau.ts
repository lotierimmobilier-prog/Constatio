import { expect, type Page } from '@playwright/test';

/** Prend la photo du trousseau sur l'écran des clés : elle est exigée par les contrôles dès qu'une clé est décrite. */
export async function photoTrousseau(page: Page, edl: string) {
  await page.goto(`/app/edl/${edl}/cles`);
  await expect(page.getByTestId('trousseau-manquant')).toBeVisible();
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Photo du trousseau' }) });
  await section.locator('input[type=file]').setInputFiles({ name: 'trousseau.png', mimeType: 'image/png', buffer: await page.screenshot() });
  await expect(page.getByTestId('trousseau-manquant')).toHaveCount(0);
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
}
