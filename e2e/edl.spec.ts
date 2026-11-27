import { expect, test, type Page } from '@playwright/test';

const email = `zzrec-edl-${Date.now()}@constatio.test`;
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
};
const element = (page: Page, categorie: string) => page.getByTestId(`element-${categorie}`).first();

test.describe.configure({ mode: 'serial' });
// Chaque test repart d'un navigateur vierge : on laisse la file d'envoi se vider avant de le fermer.
test.afterEach(async ({ page }) => {
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });
});

test('création d’un état des lieux d’entrée (T2 meublé)', async ({ page }) => {
  await page.goto('/inscription');
  await page.getByLabel('Prénom').fill('Claire');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();

  // Un oubli est expliqué, rien n'est créé.
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByRole('alert')).toHaveText('Indiquez l’adresse et la ville du logement.');

  await page.getByText('T2', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('12 rue des Balances');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Surface habitable (m²)').fill('28,4');
  await page.getByLabel('Nom du logement').fill('ZZREC T2 Balances');
  await page.getByLabel(/Logement meublé/).check();
  await photo(page, '6-nouvel-edl');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();

  await expect(page).toHaveURL(/\/app\/edl\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'ZZREC T2 Balances' })).toBeVisible();
  await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
  // Trame T2 : entrée, séjour, cuisine, chambre, salle de bain, WC, équipements.
  await expect(page.getByRole('listitem')).toHaveCount(7);
  await expect(page.getByTestId('avancement')).toContainText('0 élément sur');
  await expect(page.getByText('Locataire à renseigner')).toBeVisible();
});

test('visite d’une pièce : états, détail, élément ajouté, enregistrement', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /ZZREC T2 Balances/ }).click();
  await page.getByRole('link', { name: /Séjour/ }).click();
  await expect(page.getByRole('heading', { name: 'Séjour' })).toBeVisible();

  await element(page, 'sol').getByRole('button', { name: 'Bon état' }).click();
  await element(page, 'murs').getByRole('button', { name: 'État d’usage' }).click();
  await element(page, 'volets').getByRole('button', { name: 'Hors service' }).click();
  await element(page, 'sol').getByRole('button', { name: 'Détail' }).click();
  await page.getByLabel('Nature, matériau').fill('Parquet stratifié');
  await page.getByLabel('Observations', { exact: true }).fill('Rayure de 10 cm près de la fenêtre');
  await page.getByLabel('Observations sur la pièce').click(); // quitter le champ enregistre
  await expect(element(page, 'sol')).toContainText('Sol · Parquet stratifié');

  await element(page, 'tringles').getByRole('button', { name: 'Détail' }).click();
  await element(page, 'tringles').getByRole('button', { name: 'Sans objet' }).click();
  await page.getByLabel('Ajouter un élément').fill('Cheminée');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Cheminée')).toBeVisible();
  await photo(page, '8-visite-piece');

  // Tout est bien en base : on recharge et on retrouve la saisie.
  await page.reload();
  await expect(element(page, 'sol').getByRole('button', { name: 'Bon état' })).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, 'volets').getByRole('button', { name: 'Hors service' })).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, 'sol')).toContainText('Note ✓');
  await expect(element(page, 'tringles')).toContainText('Sans objet');

  // Un second appui efface l'état.
  await element(page, 'murs').getByRole('button', { name: 'État d’usage' }).click();
  await expect(element(page, 'murs').getByRole('button', { name: 'État d’usage' })).toHaveAttribute('aria-pressed', 'false');
  await element(page, 'murs').getByRole('button', { name: 'Mauvais état' }).click();

  await page.getByRole('link', { name: /Pièce suivante : Cuisine/ }).click();
  await expect(page.getByRole('heading', { name: 'Cuisine' })).toBeVisible();
  await page.getByRole('link', { name: '← Toutes les pièces' }).click();
  await expect(page.getByTestId('avancement')).toContainText('4 éléments sur');
  await expect(page.getByTestId('avancement')).toContainText('2 à signaler');
  await photo(page, '7-vue-ensemble');
});

test('pièces : ajout d’un jardin, renommage, suppression', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /ZZREC T2 Balances/ }).click();
  await page.getByRole('button', { name: 'Ajouter une pièce ou un extérieur' }).click();
  await page.getByLabel('Type de pièce').selectOption('jardin');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(8);
  await page.getByRole('link', { name: /Jardin et extérieurs/ }).click();
  await expect(page.getByText('Palmiers, bambous et plantes invasives')).toBeVisible();
  await element(page, 'pelouse').getByRole('button', { name: 'Détail' }).click();
  await expect(page.getByLabel('Tondue le…')).toBeVisible();

  await page.getByRole('button', { name: 'Renommer ou supprimer cette pièce' }).click();
  await page.getByLabel('Nom de la pièce').fill('Cour arrière');
  await page.getByRole('button', { name: 'Renommer' }).click();
  await expect(page.getByRole('heading', { name: 'Cour arrière' })).toBeVisible();
  await page.getByRole('button', { name: 'Renommer ou supprimer cette pièce' }).click();
  await page.getByRole('button', { name: 'Supprimer la pièce' }).click();
  await expect(page).toHaveURL(/\/app\/edl\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('listitem')).toHaveCount(7);
});

test('parties : bailleur repris du compte, locataire ajouté', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: /ZZREC T2 Balances/ }).click();
  await page.getByRole('link', { name: /Parties/ }).click();
  await expect(page.getByRole('heading', { name: 'Bailleur · ZZREC Vidal' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un locataire' }).click();
  const fiche = page.locator('section', { has: page.getByRole('heading', { name: 'Locataire', exact: true }) });
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche.getByRole('alert')).toContainText('Indiquez le nom');
  await fiche.getByLabel('Prénom').fill('Hugo');
  await fiche.getByLabel('Nom ou société').fill('ZZREC Marty');
  await fiche.getByLabel('E-mail').fill('zzrec-hugo@constatio.test');
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Locataire · Hugo ZZREC Marty' })).toBeVisible();
  await photo(page, '9-parties');
  await page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();
  await expect(page.getByText('Locataire : Hugo ZZREC Marty')).toBeVisible();
});

test('sortie : repart de l’entrée et affiche l’état d’origine', async ({ page }) => {
  await connecter(page);
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByLabel(/^Sortie/).check();
  await expect(page.getByLabel(/Repartir de l’état des lieux d’entrée/)).toBeChecked();
  await page.getByLabel('État des lieux d’entrée', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page).toHaveURL(/\/app\/edl\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/^Sortie ·/)).toBeVisible();
  // Mêmes pièces et mêmes parties que l'entrée ; rien n'est encore constaté.
  await expect(page.getByRole('listitem')).toHaveCount(7);
  await expect(page.getByText('Locataire : Hugo ZZREC Marty')).toBeVisible();
  await expect(page.getByTestId('avancement')).toContainText('0 élément sur');

  await page.getByRole('link', { name: /Séjour/ }).click();
  await expect(element(page, 'sol')).toContainText('À l’entrée : Bon état');
  await expect(element(page, 'sol')).toContainText('Parquet stratifié');
  await expect(page.getByText('Cheminée')).toBeVisible();
  // Un état différent de l'entrée est mis en évidence.
  await element(page, 'sol').getByRole('button', { name: 'Mauvais état' }).click();
  await expect(element(page, 'sol').getByText('À l’entrée : Bon état')).toHaveClass(/text-mauvais/);
  await element(page, 'sol').getByRole('button', { name: 'Détail' }).click();
  await expect(page.getByText('À l’entrée : Rayure de 10 cm près de la fenêtre')).toBeVisible();
  await photo(page, '10-sortie');

  // La sortie exige la nouvelle adresse du locataire.
  await page.getByRole('link', { name: '← Toutes les pièces' }).click();
  await page.getByRole('link', { name: /Parties/ }).click();
  await expect(page.getByLabel('Nouvelle adresse du locataire')).toBeVisible();

  // ── Dépôt de garantie : la dégradation relevée devient une retenue, vétusté déduite ──────────
  await page.getByRole('link', { name: '← Retour à l’état des lieux' }).click();
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  await page.getByTestId('lien-decompte').click();
  await expect(page.getByRole('heading', { name: 'Dépôt de garantie', level: 1 })).toBeVisible();
  await expect(page.getByTestId('ecart')).toHaveCount(1);
  await expect(page.getByTestId('ecart')).toContainText('Séjour · Sol');
  await expect(page.getByTestId('ecart')).toContainText('Bon état à l’entrée, mauvais état à la sortie');
  await page.getByLabel('Dépôt de garantie versé (€)').fill('800');
  await page.getByLabel('Dépôt de garantie versé (€)').blur();
  // Sans retenue, une dégradation suffit à faire passer le délai à deux mois.
  await expect(page.getByTestId('a-restituer')).toHaveText('800,00 €');
  await expect(page.getByTestId('delai')).toContainText('deux mois');
  await page.getByTestId('ecart').getByRole('button', { name: 'Ajouter une retenue' }).click();
  const retenue = page.getByTestId('retenue');
  await expect(retenue.getByLabel('Réparation')).toHaveValue('Séjour : sol');
  await retenue.getByLabel('Montant du devis ou de la facture (€)').fill('450');
  await retenue.getByLabel('Montant du devis ou de la facture (€)').blur();
  await expect(retenue.getByTestId('montant-retenu')).toHaveText('450,00 €');
  await retenue.getByLabel('Vétusté à déduire').selectOption({ label: 'Parquet, stratifié · durée de vie 15 ans' });
  await retenue.getByLabel('Âge de l’élément à la sortie (années)').fill('6');
  await retenue.getByLabel('Âge de l’élément à la sortie (années)').blur();
  // 6 ans sur 15, 15 % restant toujours au locataire : 34 % de vétusté, 297 € retenus.
  await expect(retenue).toContainText('Vétusté déduite : 34 %');
  await expect(retenue.getByTestId('montant-retenu')).toHaveText('297,00 €');
  await page.getByLabel('Loyers ou charges impayés (€)').fill('53,50');
  await page.getByLabel('Loyers ou charges impayés (€)').blur();
  await expect(page.getByTestId('a-restituer')).toHaveText('449,50 €');
  await photo(page, '11-decompte');
  const { execFileSync } = await import('node:child_process');
  const telechargement = page.waitForEvent('download');
  await page.getByTestId('telecharger-decompte').click();
  const fichier = await (await telechargement).path();
  const pdf = execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  for (const attendu of ['Décompte de restitution du dépôt de garantie', 'Séjour : sol', '- 297,00 €', 'vétusté déduite : 34 %', 'Somme restituée au locataire 449,50 €', 'deux mois après la remise des clés', 'ZZREC Marty']) expect(pdf, attendu).toContain(attendu);
  // Tout est gardé : au rechargement, le décompte est intact.
  await page.reload();
  await expect(page.getByTestId('a-restituer')).toHaveText('449,50 €');
  await expect(page.getByTestId('retenue')).toHaveCount(1);
});

test('un brouillon se supprime après confirmation', async ({ page }) => {
  await connecter(page);
  await expect(page.getByRole('link', { name: /ZZREC T2 Balances/ })).toHaveCount(2);
  await page.getByRole('link', { name: /ZZREC T2 Balances/ }).first().click();
  await page.getByRole('button', { name: 'Supprimer ce brouillon' }).click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('link', { name: /ZZREC T2 Balances/ })).toHaveCount(1);
});
