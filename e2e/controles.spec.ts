import { expect, test, type Page } from '@playwright/test';

const email = `zzrec-ctl-${Date.now()}@constatio.test`;
const MDP = 'zzrec-motdepasse-1';
const captures = process.env.CAPTURES;
const photo = async (page: Page, nom: string) => {
  if (captures) await page.screenshot({ path: `${captures}/${nom}.png` });
};
const connecter = async (page: Page) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('link', { name: /ZZREC Studio/ }).click();
};
const retour = (page: Page) => page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();

test.describe.configure({ mode: 'serial' });

test('un brouillon neuf : les contrôles listent ce qui manque et y renvoient', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Studio', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('4 place Jean-Jaurès');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Studio');
  await page.getByLabel(/Logement meublé/).check();
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();

  // 1 locataire + 6 pièces + 4 compteurs + clés + inventaire = 13 points.
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : 13 points à corriger');
  await page.getByTestId('lien-controles').click();
  await expect(page.getByTestId('verdict')).toHaveText('13 points à corriger');
  await expect(page.getByText('Aucun locataire n’est identifié.')).toBeVisible();
  await expect(page.getByText('Gaz : compteur non relevé. Indiquez l’index, ou qu’il n’y a pas de compteur.')).toBeVisible();
  await expect(page.getByText('Aucune clé n’est décrite.')).toBeVisible();
  await expect(page.getByText(/Meublé : il manque literie avec couette/)).toBeVisible();
  await photo(page, '11-controles');
  // L'alerte mène à l'étape concernée.
  await page.getByRole('link', { name: 'Aller aux clés' }).click();
  await expect(page.getByRole('heading', { name: 'Clés et accès' })).toBeVisible();
});

test('compteurs : relevé, double tarif, absence déclarée, saisie refusée', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /Compteurs/ }).click();

  const elec = page.locator('section', { has: page.getByRole('heading', { name: 'Électricité' }) });
  await elec.getByLabel(/Double tarif/).check();
  await elec.getByLabel('Heures pleines (kWh)').fill('18 432');
  await elec.getByLabel('Heures creuses (kWh)').fill('abc');
  await elec.getByLabel('Numéro du compteur').click();
  await expect(elec.getByRole('alert')).toContainText('L’index doit être un nombre');
  await elec.getByLabel('Heures creuses (kWh)').fill('9877');
  await elec.getByLabel('Numéro du compteur').fill('09451302118760');
  await elec.getByLabel('Emplacement').click();
  await expect(page.getByTestId('etat-electricite')).toHaveText('Enregistré');

  const eau = page.locator('section', { has: page.getByRole('heading', { name: 'Eau froide' }) });
  await eau.getByLabel('Index (m³)').fill('214,5');
  await eau.getByLabel('Numéro du compteur').fill('E-1207');
  await eau.getByLabel('Emplacement').fill('Placard de l’entrée');
  await eau.getByLabel('Index (m³)').click();
  await expect(page.getByTestId('etat-eau_froide')).toHaveText('Enregistré');

  await page.locator('section', { has: page.getByRole('heading', { name: 'Eau chaude' }) }).getByRole('checkbox').check();
  await page.locator('section', { has: page.getByRole('heading', { name: 'Gaz' }) }).getByLabel('Pas de gaz dans le logement').check();
  await expect(page.getByTestId('etat-gaz')).toHaveText('Enregistré');
  await photo(page, '12-compteurs');

  await page.reload();
  await expect(elec.getByLabel('Heures pleines (kWh)')).toHaveValue('18432');
  await expect(elec.getByLabel('Heures creuses (kWh)')).toHaveValue('9877');
  await expect(eau.getByLabel('Index (m³)')).toHaveValue('214,5');
  await expect(page.getByLabel('Pas de gaz dans le logement')).toBeChecked();
  await retour(page);
  await expect(page.getByText('4 sur 4 relevés ou déclarés')).toBeVisible();
});

test('clés : ajout rapide, nombre, destination', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /Clés et accès/ }).click();
  await page.getByRole('button', { name: '+ Porte d’entrée du logement' }).click();
  await page.getByRole('button', { name: 'Un de plus' }).click();
  await page.getByRole('button', { name: 'Un de plus' }).click();
  await page.getByRole('button', { name: '+ Accès immeuble' }).click();
  await expect(page.getByTestId('total-cles')).toHaveText('4 éléments remis');
  await page.getByRole('button', { name: 'Autre clé ou accès' }).click();
  await expect(page.getByLabel('Ce qu’il ouvre')).toHaveCount(3);
  await page.getByLabel('Ce qu’il ouvre').last().fill('Local vélos');
  await photo(page, '13-cles');
  await page.waitForTimeout(900); // l'enregistrement suit la dernière frappe
  await page.reload();
  await expect(page.getByTestId('total-cles')).toHaveText('5 éléments remis');
  await expect(page.getByLabel('Ce qu’il ouvre').last()).toHaveValue('Local vélos');
  await expect(page.getByTestId('nombre').first()).toHaveText('3');
});

test('inventaire du meublé : les équipements du décret, un par un puis d’un coup', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /Inventaire du mobilier/ }).click();
  await expect(page.getByTestId('decompte-decret')).toHaveText('0 sur 11 présents.');
  await page.getByRole('button', { name: /Plaques de cuisson/ }).click();
  await expect(page.getByTestId('decompte-decret')).toHaveText('1 sur 11 présents.');
  await page.getByTestId('mobilier-plaques').getByRole('button', { name: 'Bon état' }).click();
  await page.getByRole('button', { name: 'Tout est présent' }).click();
  await expect(page.getByTestId('decompte-decret')).toHaveText('Les 11 équipements sont présents.');
  await page.getByLabel('Ajouter').fill('Canapé convertible');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByTestId('mobilier-libre')).toContainText('Canapé convertible');
  await photo(page, '14-inventaire');
  // Retirer un équipement obligatoire fait revenir l'alerte.
  await page.getByTestId('mobilier-four').getByRole('button', { name: 'Absent du logement' }).click();
  await expect(page.getByTestId('decompte-decret')).toHaveText('10 sur 11 présents.');
  await retour(page);
  await page.getByTestId('lien-controles').click();
  await expect(page.getByText('Meublé : il manque four ou four à micro-ondes (décret n° 2015-981).')).toBeVisible();
  await page.getByRole('link', { name: 'Compléter l’inventaire' }).click();
  await page.getByRole('button', { name: /Four ou four à micro-ondes/ }).click();
  await expect(page.getByTestId('decompte-decret')).toHaveText('Les 11 équipements sont présents.');
});

test('tout complété : plus aucun point bloquant, les conseils restent', async ({ page }) => {
  await connecter(page);
  // Locataire
  await page.getByRole('link', { name: /Parties/ }).click();
  await page.getByRole('button', { name: 'Ajouter un locataire' }).click();
  const fiche = page.locator('section', { has: page.getByRole('heading', { name: 'Locataire', exact: true }) });
  await fiche.getByLabel('Nom ou société').fill('ZZREC Marty');
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Locataire · ZZREC Marty' })).toBeVisible();
  await retour(page);
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : 6 points à corriger');

  // Visite : « bon état » partout, sauf un élément hors service laissé sans observation.
  await page.getByRole('listitem').first().getByRole('link').click();
  for (let piece = 0; piece < 6; piece++) {
    await expect(page.getByText(`pièce ${piece + 1} / 6`)).toBeVisible();
    await page.waitForLoadState('networkidle');
    const boutons = page.getByRole('button', { name: 'Bon état' });
    await boutons.first().waitFor();
    const n = await boutons.count();
    for (let i = 0; i < n; i++) await boutons.nth(i).click();
    if (piece === 0) await page.getByTestId('element-interphone').getByRole('button', { name: 'Hors service' }).click();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(n);
    if (piece < 5) await page.getByRole('link', { name: /Pièce suivante/ }).click();
    else await page.getByRole('link', { name: /Dernière pièce/ }).click();
  }
  await page.getByLabel('Remarques générales').fill('Logement repeint avant l’entrée.');
  await page.getByRole('heading', { name: 'Pièces' }).click();
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : tout est complet');
  await page.getByTestId('lien-controles').click();
  await expect(page.getByTestId('verdict')).toHaveText('Toutes les mentions obligatoires sont renseignées.');
  await expect(page.getByText(/Entrée : interphone \/ sonnette en mauvais état sans observation/)).toBeVisible();
  await photo(page, '15-controles-complets');
  await retour(page);
  await expect(page.getByLabel('Remarques générales')).toHaveValue('Logement repeint avant l’entrée.');
});
