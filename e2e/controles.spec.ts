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
// Chaque test repart d'un navigateur vierge : on laisse la file d'envoi se vider avant de le fermer.
test.afterEach(async ({ page }) => {
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });
});

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

  // 1 locataire + adresse du bailleur + 6 pièces + 4 compteurs + clés + inventaire = 14 points.
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : 14 points à corriger');
  await page.getByTestId('lien-controles').click();
  await expect(page.getByTestId('verdict')).toHaveText('14 points à corriger');
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

  // Eau froide : compteur individuel, vérifié en faisant couler l'eau ; la photo de chaque compteur relevé est obligatoire.
  await eau.getByLabel(/Compteur vérifié/).check();
  const cliche = Buffer.from(await page.evaluate(() => { const t = document.createElement('canvas'); t.width = 800; t.height = 600; const c = t.getContext('2d')!; c.fillStyle = '#777'; c.fillRect(0, 0, 800, 600); return t.toDataURL('image/jpeg', 0.8).split(',')[1]; }), 'base64');
  for (const carte of [elec, eau]) {
    await carte.locator('input[type=file]').setInputFiles({ name: 'compteur.jpg', mimeType: 'image/jpeg', buffer: cliche });
    await expect(carte.getByTestId('photos').getByRole('button', { name: /^Photo du/ })).toHaveCount(1);
  }
  // Eau chaude : compteur de l'immeuble, déclaré collectif (l'index devient facultatif).
  const chaude = page.locator('section', { has: page.getByRole('heading', { name: 'Eau chaude' }) });
  await chaude.getByRole('radio', { name: 'Compteur collectif' }).click();
  await expect(page.getByTestId('etat-eau_chaude')).toHaveText('Enregistré');
  await expect(page.getByRole('heading', { name: 'Chauffage collectif' })).toBeVisible();
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
  // D'un geste, « bon état » pour tout ce qui n'a pas d'état ; ce qui est déjà noté n'est pas touché.
  await page.getByTestId('mobilier-libre').getByRole('button', { name: 'Mauvais état' }).click();
  await page.getByTestId('tout-bon-etat').click();
  await expect(page.getByTestId('tout-bon-etat')).toHaveCount(0);
  await expect(page.getByTestId('mobilier-literie').getByRole('button', { name: 'Bon état' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mobilier-libre').getByRole('button', { name: 'Mauvais état' })).toHaveAttribute('aria-pressed', 'true');
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
  // Bailleur : son adresse est une mention obligatoire.
  const bailleur = page.locator('section', { has: page.getByRole('heading', { name: /^Bailleur/ }) });
  await bailleur.getByLabel('Adresse', { exact: true }).fill('12 rue des Balances, 34500 Béziers');
  await bailleur.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Ajouter un locataire' }).click();
  const fiche = page.locator('section', { has: page.getByRole('heading', { name: 'Locataire', exact: true }) });
  await fiche.getByLabel('Nom ou société').fill('ZZREC Marty');
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Locataire · ZZREC Marty' })).toBeVisible();
  await retour(page);
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : 7 points à corriger');

  // Visite : « bon état » partout, sauf un élément hors service laissé sans observation.
  await page.getByRole('listitem').first().getByRole('link').click();
  for (let piece = 0; piece < 6; piece++) {
    await expect(page.getByText(`pièce ${piece + 1} / 6`)).toBeVisible();
    await page.waitForLoadState('networkidle');
    const boutons = page.getByRole('button', { name: 'Bon état', exact: true });
    await boutons.first().waitFor();
    const n = await boutons.count();
    for (let i = 0; i < n; i++) await boutons.nth(i).click();
    if (piece === 0) await page.getByTestId('element-interphone').getByRole('button', { name: 'Hors service' }).click();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(n);
    if (piece === 5) {
      // Sécurité : photo obligatoire du détecteur de fumée et d'une VMC.
      const cliche = Buffer.from(await page.evaluate(() => { const t = document.createElement('canvas'); t.width = 800; t.height = 600; const c = t.getContext('2d')!; c.fillStyle = '#999'; c.fillRect(0, 0, 800, 600); return t.toDataURL('image/jpeg', 0.8).split(',')[1]; }), 'base64');
      // (la photo de la VMC sera prise plus loin, depuis l'écran des contrôles)
      // Le détecteur de fumée demande sa photo sur place, sans ouvrir le détail.
      const daaf = page.getByTestId('element-daaf').first();
      await daaf.getByTestId('photo-obligatoire').setInputFiles({ name: 'daaf.jpg', mimeType: 'image/jpeg', buffer: cliche });
      await expect(daaf.getByTestId('nb-photos')).toHaveText('1 photo');
      await expect(daaf.getByTestId('photo-obligatoire')).toHaveCount(0);
    }
    if (piece < 5) await page.getByRole('link', { name: /Pièce suivante/ }).click();
    else await page.getByRole('link', { name: /Dernière pièce/ }).click();
  }
  await page.getByLabel('Remarques générales').fill('Logement repeint avant l’entrée.');
  await page.getByRole('heading', { name: 'Pièces' }).click();
  // Il manque la photo de la VMC : l'écran des contrôles la demande et permet de la prendre sur place.
  await expect(page.getByTestId('lien-controles')).toHaveText('Contrôles : 2 points à corriger');
  await page.getByTestId('lien-controles').click();
  await expect(page.getByText('VMC / aération : au moins une photo est obligatoire.')).toBeVisible();
  await expect(page.getByText('Clés : la photo du trousseau est obligatoire.')).toBeVisible();
  const vue = Buffer.from(await page.evaluate(() => { const t = document.createElement('canvas'); t.width = 800; t.height = 600; const c = t.getContext('2d')!; c.fillStyle = '#888'; c.fillRect(0, 0, 800, 600); return t.toDataURL('image/jpeg', 0.8).split(',')[1]; }), 'base64');
  await page.getByTestId('photo-demandee').first().setInputFiles({ name: 'vmc.jpg', mimeType: 'image/jpeg', buffer: vue });
  // Le trousseau se photographie de la même façon, sans quitter l'écran des contrôles.
  await expect(page.getByTestId('photo-demandee')).toHaveCount(1);
  await page.getByTestId('photo-demandee').setInputFiles({ name: 'trousseau.jpg', mimeType: 'image/jpeg', buffer: vue });
  await expect(page.getByTestId('verdict')).toHaveText('Toutes les mentions obligatoires sont renseignées.');
  await expect(page.getByText(/Entrée : interphone \/ sonnette en mauvais état sans observation/)).toBeVisible();
  await photo(page, '15-controles-complets');
  await retour(page);
  await expect(page.getByLabel('Remarques générales')).toHaveValue('Logement repeint avant l’entrée.');
});
