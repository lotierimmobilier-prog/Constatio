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

// ── La liaison réelle : fonctions serveur exécutées, messages et liens signés ───────
import { createHmac } from 'node:crypto';
const SECRET = 'secret-local-signabail'; // celui de la pile locale (dev/pile-locale.sh)
const signer = (corps: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${corps}`).digest('hex')}`;
/** Jeton fabriqué comme le fait Signabail (apps/web/src/lib/constatio.ts). */
function jetonPassage(p: { compte: string; email: string; bail: string | null }, dureeS = 60) {
  const charge = Buffer.from(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + dureeS })).toString('base64url');
  return `${charge}.${createHmac('sha256', SECRET).update(`passage.${charge}`).digest('hex')}`;
}

test('fonction serveur : un message Signabail n’est accepté que correctement signé', async ({ request }) => {
  const m = Date.now();
  const corps = JSON.stringify({ id: `signabail-bail-reel-${m}`, type: 'bail.genere', test: false, compte: { id: `sb-reel-${m}` },
    bail: { id: `reel-${m}`, type: 'vide', genere_le: new Date().toISOString(), date_entree: '2026-12-01', depot_garantie: 700,
      logement: { adresse: '1 rue du Test', code_postal: '34500', ville: 'Béziers', type_bien: 'appartement', surface_m2: 40, nb_pieces: 2, meuble: false },
      bailleur: { prenom: 'Claire', nom: 'ZZREC Vidal' }, co_bailleurs: [], mandataire: null, locataires: [{ prenom: 'Hugo', nom: 'ZZREC Marty' }] } });
  const url = '/functions/v1/webhook-signabail';
  const sans = await request.post(url, { data: corps, headers: { 'Content-Type': 'application/json' } });
  expect([sans.status(), await sans.json()]).toEqual([401, { erreur: 'signature_absente' }]);
  const fausse = await request.post(url, { data: corps, headers: { 'Content-Type': 'application/json', 'X-Partenaire-Signature': signer(`${corps} `) } });
  expect([fausse.status(), await fausse.json()]).toEqual([401, { erreur: 'signature_fausse' }]);
  const vieille = await request.post(url, { data: corps, headers: { 'Content-Type': 'application/json', 'X-Partenaire-Signature': signer(corps, Math.floor(Date.now() / 1000) - 600) } });
  expect([vieille.status(), await vieille.json()]).toEqual([401, { erreur: 'signature_perimee' }]);
  expect(sql(`select count(*) from public.webhook_evenements where evenement_id = 'signabail-bail-reel-${m}'`)).toBe('0'); // rien n'est entré

  const bonne = await request.post(url, { data: corps, headers: { 'Content-Type': 'application/json', 'X-Partenaire-Signature': signer(corps) } });
  expect([bonne.status(), await bonne.json()]).toEqual([200, { resultat: 'en_attente' }]);
  const rejouee = await request.post(url, { data: corps, headers: { 'Content-Type': 'application/json', 'X-Partenaire-Signature': signer(corps) } });
  expect(await rejouee.json()).toEqual({ resultat: 'deja_recu' });
});

test('lien de passage : première venue depuis Signabail, compte créé et brouillon ouvert', async ({ page, request }) => {
  const m = Date.now();
  const email = `zzrec-passage-${m}@constatio.test`;
  const corps = JSON.stringify({ id: `signabail-bail-p-${m}`, type: 'bail.genere', test: false, compte: { id: `sb-p-${m}` },
    bail: { id: `p-${m}`, type: 'vide', genere_le: new Date().toISOString(), date_entree: '2026-12-01', depot_garantie: 700,
      logement: { adresse: '5 rue du Passage', code_postal: '34500', ville: 'Béziers', type_bien: 'appartement', surface_m2: 40, nb_pieces: 1, meuble: false },
      bailleur: { prenom: 'Claire', nom: 'ZZREC Vidal' }, co_bailleurs: [], mandataire: null, locataires: [{ prenom: 'Hugo', nom: 'ZZREC Marty' }] } });
  await request.post('/functions/v1/webhook-signabail', { data: corps, headers: { 'Content-Type': 'application/json', 'X-Partenaire-Signature': signer(corps) } });

  // Un lien expiré est refusé avec une explication, et aucun compte n'est créé.
  await page.goto(`/passage#j=${jetonPassage({ compte: `sb-p-${m}`, email, bail: `p-${m}` }, -5)}`);
  await expect(page.getByRole('alert')).toContainText('Ce lien a expiré');
  expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe('0');

  // Un lien valable : session ouverte, compte relié, message en attente traité, brouillon du bail affiché.
  await page.goto('/');
  await page.goto(`/passage#j=${jetonPassage({ compte: `sb-p-${m}`, email, bail: `p-${m}` })}`);
  await expect(page).toHaveURL(/\/app\/edl\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText('Pré-rempli depuis votre bail Signabail')).toBeVisible();
  await expect(page.getByText('Locataire : Hugo ZZREC Marty')).toBeVisible();
  expect(sql(`select count(*) from public.credit_lots l join public.organisations o on o.id = l.organisation_id where o.signabail_compte_id = 'sb-p-${m}' and l.origine = 'signabail'`)).toBe('1');
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 15_000 });
});

test('lien de passage : un compte Constatio existant n’est pas ouvert sans connexion', async ({ page }) => {
  const m = Date.now();
  const email = `zzrec-existant-${m}@constatio.test`;
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Existant');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/compte');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Quelqu'un arrive de Signabail avec la même adresse : pas de session, on demande de se connecter.
  await page.goto(`/passage#j=${jetonPassage({ compte: `sb-x-${m}`, email, bail: null })}`);
  await expect(page.getByRole('heading', { name: 'Reliez vos deux comptes' })).toBeVisible();
  expect(sql(`select count(*) from public.organisations where signabail_compte_id = 'sb-x-${m}'`)).toBe('0');
  await page.getByRole('link', { name: 'Me connecter à Constatio' }).click();
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  // Une fois connectée, la personne voit ses comptes reliés et arrive dans son espace.
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  expect(sql(`select count(*) from public.organisations where signabail_compte_id = 'sb-x-${m}'`)).toBe('1');
});
