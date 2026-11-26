import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-rafale-${Date.now()}@constatio.test`;

// Une caméra simulée par le navigateur : la rafale se teste sans appareil réel.
test.use({ permissions: ['camera'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('rafale : chaque appui prend une photo et l’enregistre sans autre geste', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('9 rue de la Rafale');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage rafale');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('reprendre').click();
  const sol = page.getByTestId('element-sol').first();
  await sol.getByRole('button', { name: 'Détail' }).click();

  await sol.getByTestId('ouvrir-rafale').click();
  const rafale = page.getByTestId('rafale');
  await expect(rafale.getByTestId('rafale-prendre')).toBeEnabled({ timeout: 15_000 });
  for (let i = 0; i < 3; i++) await rafale.getByTestId('rafale-prendre').click();
  await expect(rafale.getByTestId('rafale-compte')).toHaveText('3 photos enregistrées', { timeout: 20_000 });
  await rafale.getByTestId('rafale-fin').click();
  await expect(rafale).toHaveCount(0);

  // Les trois photos sont là, et partent au serveur sans rien demander.
  await expect(sol.getByTestId('nb-photos')).toHaveText('3 photos');
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 30_000 });
  const edl = page.url().match(/edl\/([0-9a-f-]{36})/)![1];
  expect(sql(`select count(*) from public.edl_photos where edl_id = '${edl}'`)).toBe('3');
  expect(sql(`select count(*) from storage.objects where bucket_id = 'edl' and name like '%/${edl}/photos/%'`)).toBe('3');
});
