import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-ds-${Date.now()}@constatio.test`;
const SIGNE = Buffer.from('%PDF-1.4\n% document signé chez le faux DocuSeal\n%%EOF\n');

// Faux Stripe (page de paiement) et faux DocuSeal (demande, état, document signé), aux adresses données à la pile locale.
const stripe: Record<string, string>[] = [];
const docuseal: { chemin: string; cle: string; corps: any }[] = [];
let etat = 'pending';
let serveurs: Server[] = [];
test.beforeAll(async () => {
  const lire = (q: any) => new Promise<string>((ok) => { let c = ''; q.on('data', (d: Buffer) => (c += d)); q.on('end', () => ok(c)); });
  const s1 = createServer(async (q, r) => {
    stripe.push(Object.fromEntries(new URLSearchParams(await lire(q))));
    r.setHeader('Content-Type', 'application/json');
    r.end(JSON.stringify({ id: 'cs_test_ds', url: stripe.at(-1)!.success_url }));
  });
  const s2 = createServer(async (q, r) => {
    const corps = await lire(q);
    if (q.url === '/signe.pdf') { r.setHeader('Content-Type', 'application/pdf'); return r.end(SIGNE); }
    docuseal.push({ chemin: `${q.method} ${q.url}`, cle: String(q.headers['x-auth-token'] ?? ''), corps: corps ? JSON.parse(corps) : null });
    r.setHeader('Content-Type', 'application/json');
    if (q.url === '/submissions/pdf') return r.end(JSON.stringify(docuseal.at(-1)!.corps.submitters.map((s: { email: string }, i: number) => ({ submission_id: 77, email: s.email, slug: `lien${i}` }))));
    if (q.url === '/submissions/77') return r.end(JSON.stringify({ status: etat, submitters: [] }));
    if (q.url === '/submissions/77/documents') return r.end(JSON.stringify({ documents: [{ url: 'http://127.0.0.1:54398/signe.pdf' }] }));
    r.statusCode = 404; r.end('{}');
  });
  await new Promise<void>((ok) => s1.listen(54399, '127.0.0.1', ok));
  await new Promise<void>((ok) => s2.listen(54398, '127.0.0.1', ok));
  serveurs = [s1, s2];
});
test.afterAll(() => {
  serveurs.forEach((s) => s.close());
  sql(`update public.parametres set valeur = 'true' where cle = 'mode_test'; delete from private.cles_service where nom like 'docuseal_%'`);
});

async function payer(page: Page, org: string, edl: string) {
  const corps = JSON.stringify({ id: `evt_ds_${edl}`, type: 'checkout.session.completed', livemode: false,
    data: { object: { id: 'cs_test_ds', mode: 'payment', payment_status: 'paid', payment_intent: `pi_ds_${edl}`, metadata: { organisation_id: org, tarif_code: 'signature_electronique', edl_id: edl } } } });
  const t = Math.floor(Date.now() / 1000);
  return page.request.post('/functions/v1/webhook-stripe', { headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${createHmac('sha256', 'whsec_pile_locale').update(`${t}.${corps}`).digest('hex')}` }, data: corps });
}

test('signature électronique : 5 € réglés, envoi par DocuSeal, document signé rapatrié', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('link', { name: 'Nouvel état des lieux' }).click();
  await page.getByText('Garage / parking', { exact: true }).click();
  await page.getByLabel('Adresse', { exact: true }).fill('2 rue du Sceau');
  await page.getByLabel('Code postal').fill('34500');
  await page.getByLabel('Ville').fill('Béziers');
  await page.getByLabel('Nom du logement').fill('ZZREC Garage DocuSeal');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByTestId('reprendre')).toBeVisible();
  await expect(page.getByTestId('envoi')).toHaveCount(0, { timeout: 20_000 });
  const edl = page.url().match(/edl\/([0-9a-f-]{36})/)![1];
  const org = sql(`select organisation_id from public.edl where id = '${edl}'`);
  sql(`update public.edl_parties set adresse = '1 rue des Tests, 34500 Béziers', email = 'bailleur-${edl}@constatio.test' where edl_id = '${edl}' and role = 'bailleur';
       update public.edl_elements set etat = 'bon' where edl_id = '${edl}';
       insert into public.edl_parties (edl_id, role, prenom, nom, email, ordre) values ('${edl}', 'locataire', 'Hugo', 'ZZREC Marty', 'hugo-${edl}@constatio.test', 1);
       insert into public.edl_cles (edl_id, nature, nombre, destination) values ('${edl}', 'cle', 1, 'Porte du garage');
       delete from public.credit_lots where organisation_id = '${org}';
       insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le) values ('${org}', 'geste_commercial', 1, 1, now() + interval '1 year');`);
  await page.goto(`/app/edl/${edl}/apercu`);
  await page.getByTestId('generer').click();
  await page.getByTestId('renonciation').check();
  await page.getByTestId('confirmer-generation').click();
  await expect(page.getByText('Document généré.')).toBeVisible({ timeout: 60_000 });

  const bloc = page.getByTestId('signature-electronique');
  await expect(bloc).toContainText('5,00 € par état des lieux');

  // ── Paiement des 5 € ────────────────────────────────────────────────────────────
  await bloc.getByTestId('payer-electronique').click();
  await expect(page).toHaveURL(/signature=payee/, { timeout: 30_000 });
  expect(stripe.at(-1)).toMatchObject({ mode: 'payment', 'line_items[0][price_data][unit_amount]': '500', 'metadata[tarif_code]': 'signature_electronique', 'metadata[edl_id]': edl });
  expect((await (await payer(page, org, edl)).json()).issue).toBe('traite');
  await expect(bloc.getByTestId('envoyer-electronique')).toBeVisible({ timeout: 30_000 });
  expect(sql(`select count(*) from public.credit_lots where reference = 'stripe:pi_ds_${edl}'`)).toBe('0');

  // ── Mode test : rien ne part chez le prestataire ────────────────────────────────
  await bloc.getByTestId('envoyer-electronique').click();
  await expect(page.getByText(/Mode test : la demande est enregistrée, mais rien n’est parti/)).toBeVisible({ timeout: 30_000 });
  expect(docuseal.length).toBe(0);
  // Pendant une demande électronique, plus de signature à la main.
  await expect(page.getByTestId('signer-ici')).toHaveCount(0);

  // ── Mode réel : la demande part chez DocuSeal avec la clé saisie dans l'administration ──
  sql(`update public.parametres set valeur = 'false' where cle = 'mode_test';
       insert into private.cles_service (nom, valeur) values ('docuseal_cle', 'cle-docuseal-de-test-0123456789'), ('docuseal_url', 'http://127.0.0.1:54398');
       select public.edl_signature_annulee('${edl}');`);
  await page.reload();
  await bloc.getByTestId('envoyer-electronique').click();
  await expect(bloc.getByTestId('electronique-en-cours')).toBeVisible({ timeout: 30_000 });
  const envoi = docuseal.find((d) => d.chemin === 'POST /submissions/pdf')!;
  expect(envoi.cle).toBe('cle-docuseal-de-test-0123456789');
  expect(envoi.corps.send_email).toBe(true);
  expect(envoi.corps.submitters.map((s: { email: string }) => s.email).sort()).toEqual([`bailleur-${edl}@constatio.test`, `hugo-${edl}@constatio.test`].sort());
  // Le document envoyé est exactement celui dont l'empreinte est conservée, avec une case de signature par partie.
  expect(createHash('sha256').update(Buffer.from(envoi.corps.documents[0].file, 'base64')).digest('hex')).toBe(sql(`select pdf_sha256 from public.edl where id = '${edl}'`));
  expect(envoi.corps.documents[0].fields).toHaveLength(2);
  expect(new Set(envoi.corps.documents[0].fields.map((f: { role: string }) => f.role)).size).toBe(2);

  // Pas encore signé partout : rien ne change.
  await bloc.getByTestId('relever-electronique').click();
  await expect(page.getByText('Toutes les parties n’ont pas encore signé.')).toBeVisible({ timeout: 30_000 });
  expect(sql(`select statut from public.edl where id = '${edl}'`)).toBe('termine');

  // Tout le monde a signé chez DocuSeal : le document signé est rapatrié et l'état des lieux clos.
  etat = 'completed';
  await bloc.getByTestId('relever-electronique').click();
  await expect(page.getByRole('heading', { name: 'Document signé' })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select statut || ' ' || pdf_signe_sha256 from public.edl where id = '${edl}'`)).toBe(`signe ${createHash('sha256').update(SIGNE).digest('hex')}`);
  expect(sql(`select count(*) || ' ' || min(mode) || ' ' || min(fournisseur) || ' ' || min(fournisseur_ref) from public.edl_signatures where edl_id = '${edl}'`)).toBe('2 electronique docuseal 77');
  const octets = await (await page.request.get((await page.getByTestId('ouvrir-signe').getAttribute('href'))!)).body();
  expect(octets.equals(SIGNE)).toBe(true);
});
