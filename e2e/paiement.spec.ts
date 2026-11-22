import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = (requete: string) => execFileSync('psql', [BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', requete], { encoding: 'utf8' }).trim();
const email = `zzrec-paie-${Date.now()}@constatio.test`;
const captures = process.env.CAPTURES;

// Un faux Stripe, à l'adresse que la pile locale donne aux fonctions (STRIPE_API_URL) :
// il note ce que Constatio lui demande et renvoie une page de paiement « déjà payée ».
const demandes: { chemin: string; cle: string; champs: Record<string, string> }[] = [];
let faux: Server;
test.beforeAll(async () => {
  faux = createServer((q, r) => {
    let corps = '';
    q.on('data', (d) => (corps += d));
    q.on('end', () => {
      demandes.push({ chemin: q.url ?? '', cle: q.headers.authorization ?? '', champs: Object.fromEntries(new URLSearchParams(corps)) });
      r.setHeader('Content-Type', 'application/json');
      r.end(JSON.stringify(q.url === '/v1/checkout/sessions' ? { id: `cs_test_${demandes.length}`, url: 'http://127.0.0.1:5173/app/credits?paiement=ok' } : { url: 'http://127.0.0.1:5173/app/credits?portail=vu' }));
    });
  });
  await new Promise<void>((ok) => faux.listen(54399, '127.0.0.1', ok));
});
test.afterAll(() => { faux.close(); });

/** Envoie à Constatio un message signé comme le ferait Stripe. */
async function message(page: Page, evenement: Record<string, unknown>, secret = 'whsec_pile_locale') {
  const corps = JSON.stringify(evenement);
  const t = Math.floor(Date.now() / 1000);
  return page.request.post('/functions/v1/webhook-stripe', {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')}` }, data: corps,
  });
}

test('paiement : achat d’un pack, abonnement, messages refusés', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/inscription');
  await page.getByLabel('Nom', { exact: true }).fill('ZZREC Vidal');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('zzrec-motdepasse-1');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByTestId('credits').click();
  await expect(page.getByRole('heading', { name: 'Crédits et abonnement' })).toBeVisible();
  const org = sql(`select m.organisation_id from public.organisation_membres m join auth.users u on u.id = m.user_id where u.email = '${email}'`);
  sql(`delete from public.credit_lots where organisation_id = '${org}'`);
  await page.reload();
  await expect(page.getByTestId('solde')).toHaveText('0 crédit');
  // Les prix affichés sont ceux de la base.
  await expect(page.getByTestId('offre-edl_unite')).toContainText('14,90 €');
  await expect(page.getByTestId('offre-pack_5')).toContainText('59,00 €');
  await expect(page.getByTestId('offre-premium_investisseur')).toContainText('9,90 € / mois');
  await expect(page.getByText(/Mode test : aucun paiement réel/)).toBeVisible();
  if (captures) await page.screenshot({ path: `${captures}/30-credits.png`, fullPage: true });

  // ── Achat d'un pack : Constatio demande la page de paiement, au prix de la base ──────
  await page.getByTestId('offre-pack_5').getByRole('button', { name: 'Acheter' }).click();
  await expect(page.getByText(/Paiement reçu, merci/)).toBeVisible({ timeout: 30_000 });
  const commande = demandes.at(-1)!;
  expect(commande.chemin).toBe('/v1/checkout/sessions');
  expect(commande.cle).toBe('Bearer sk_test_pile_locale');
  expect(commande.champs).toMatchObject({ mode: 'payment', 'line_items[0][price_data][unit_amount]': '5900', 'line_items[0][price_data][currency]': 'eur',
    'metadata[organisation_id]': org, 'metadata[tarif_code]': 'pack_5', customer_email: email, success_url: 'http://127.0.0.1:5173/app/credits?paiement=ok' });
  // Revenir de la page de paiement ne crédite rien : seul le message de Stripe le fait.
  expect(sql(`select count(*) from public.credit_lots where organisation_id = '${org}'`)).toBe('0');

  const session = (mode: string, extra: Record<string, unknown>, tarif: string) => ({ object: { id: `cs_${tarif}`, mode, payment_status: 'paid', customer: `cus_${org}`, metadata: { organisation_id: org, tarif_code: tarif }, ...extra } });
  // Messages refusés : non signé, mal signé ; écarté : paiement « réel » alors que le mode test est actif.
  expect((await page.request.post('/functions/v1/webhook-stripe', { data: { id: 'evt_faux', type: 'checkout.session.completed' } })).status()).toBe(400);
  expect((await message(page, { id: `evt_faux_${org}`, type: 'checkout.session.completed', livemode: false, data: session('payment', { payment_intent: `pi_x_${org}` }, 'pack_10') }, 'whsec_autre')).status()).toBe(400);
  const reel = await message(page, { id: `evt_reel_${org}`, type: 'checkout.session.completed', livemode: true, data: session('payment', { payment_intent: `pi_reel_${org}` }, 'pack_10') });
  expect(await reel.json()).toEqual({ statut: 'ok', issue: 'ecarte_mode' });
  expect(sql(`select count(*) from public.credit_lots where organisation_id = '${org}'`)).toBe('0');

  const paye = await message(page, { id: `evt_1_${org}`, type: 'checkout.session.completed', livemode: false, data: session('payment', { payment_intent: `pi_1_${org}` }, 'pack_5') });
  expect(await paye.json()).toEqual({ statut: 'ok', issue: 'traite' });
  await expect(page.getByTestId('solde')).toHaveText('5 crédits', { timeout: 30_000 });
  // Stripe renvoie parfois le même message : pas de second crédit.
  expect((await (await message(page, { id: `evt_1_${org}`, type: 'checkout.session.completed', livemode: false, data: session('payment', { payment_intent: `pi_1_${org}` }, 'pack_5') })).json()).issue).toBe('deja_traite');
  expect(sql(`select sum(restant) from public.credit_lots where organisation_id = '${org}'`)).toBe('5');

  // ── Abonnement ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByTestId('offre-premium_investisseur').getByRole('button', { name: 'S’abonner' }).click();
  await expect(page.getByText(/Paiement reçu, merci/)).toBeVisible({ timeout: 30_000 });
  expect(demandes.at(-1)!.champs).toMatchObject({ mode: 'subscription', 'line_items[0][price_data][unit_amount]': '990', 'line_items[0][price_data][recurring][interval]': 'month', customer: `cus_${org}` });
  await message(page, { id: `evt_2_${org}`, type: 'checkout.session.completed', livemode: false, data: session('subscription', { subscription: `sub_${org}` }, 'premium_investisseur') });
  await expect(page.getByTestId('abonnement')).toHaveText('Premium Investisseur', { timeout: 30_000 });
  await expect(page.getByTestId('solde')).toHaveText('17 crédits');
  await expect(page.getByTestId('offre-premium_pro').getByRole('button')).toBeDisabled(); // un seul abonnement à la fois
  if (captures) await page.screenshot({ path: `${captures}/31-credits-abonne.png`, fullPage: true });

  // ── Espace de facturation Stripe ───────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Mon abonnement et mes factures' }).click();
  await expect(page).toHaveURL(/portail=vu/);
  expect(demandes.at(-1)).toMatchObject({ chemin: '/v1/billing_portal/sessions', champs: { customer: `cus_${org}` } });
});
