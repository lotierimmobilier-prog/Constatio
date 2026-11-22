import { describe, expect, it } from 'vitest';
import { cleAdmise, corpsCommande, signerStripe, verifierStripe, type Tarif } from './stripe';

const pack: Tarif = { code: 'pack_5', libelle: 'Pack 5 crédits', montant_cents: 5900, periodicite: 'unique', credits: 5 };
const premium: Tarif = { code: 'premium_investisseur', libelle: 'Premium Investisseur', montant_cents: 990, periodicite: 'mensuel', credits: 12 };
const base = { organisationId: 'org-1', email: 'a@exemple.fr', client: null, origine: 'https://constatio.fr' };

describe('signature des messages Stripe', () => {
  const corps = '{"id":"evt_1","type":"checkout.session.completed"}';
  it('accepte un message bien signé', async () => {
    expect(await verifierStripe('whsec_x', corps, await signerStripe('whsec_x', corps))).toBe('valide');
  });
  it('refuse : absent, illisible, mauvais secret, corps modifié, trop ancien', async () => {
    const bon = await signerStripe('whsec_x', corps);
    expect(await verifierStripe('whsec_x', corps, null)).toBe('absente');
    expect(await verifierStripe('whsec_x', corps, 't=abc,v1=zz')).toBe('illisible');
    expect(await verifierStripe('whsec_autre', corps, bon)).toBe('fausse');
    expect(await verifierStripe('whsec_x', corps.replace('evt_1', 'evt_2'), bon)).toBe('fausse');
    expect(await verifierStripe('whsec_x', corps, await signerStripe('whsec_x', corps, Date.now() - 6 * 60_000))).toBe('perimee');
  });
  it('accepte si une des signatures convient (renouvellement du secret)', async () => {
    const bon = await signerStripe('whsec_x', corps);
    expect(await verifierStripe('whsec_x', corps, `${bon},v1=${'0'.repeat(64)},v0=ancien`)).toBe('valide');
  });
});

describe('coupe-circuit des clés', () => {
  it('mode test : seulement une clé de test', () => {
    expect(cleAdmise('sk_test_abc', true)).toBe('ok');
    expect(cleAdmise('sk_live_abc', true)).toBe('reelle_en_mode_test');
    expect(cleAdmise(undefined, true)).toBe('absente');
  });
  it('mode réel : seulement une clé réelle', () => {
    expect(cleAdmise('sk_live_abc', false)).toBe('ok');
    expect(cleAdmise('rk_test_abc', false)).toBe('test_en_mode_reel');
  });
});

describe('commande', () => {
  it('achat : prix de la table, facture, compte et tarif rappelés pour le retour', () => {
    const f = Object.fromEntries(corpsCommande({ ...base, tarif: pack }));
    expect(f).toMatchObject({
      mode: 'payment', 'line_items[0][price_data][unit_amount]': '5900', 'line_items[0][price_data][currency]': 'eur',
      'metadata[organisation_id]': 'org-1', 'metadata[tarif_code]': 'pack_5', 'invoice_creation[enabled]': 'true',
      customer_email: 'a@exemple.fr', customer_creation: 'always', success_url: 'https://constatio.fr/app/credits?paiement=ok',
    });
    expect(f['line_items[0][price_data][recurring][interval]']).toBeUndefined();
  });
  it('abonnement : mensuel, sans facture à part', () => {
    const f = Object.fromEntries(corpsCommande({ ...base, tarif: premium }));
    expect(f).toMatchObject({ mode: 'subscription', 'line_items[0][price_data][recurring][interval]': 'month', 'subscription_data[metadata][tarif_code]': 'premium_investisseur' });
    expect(f['invoice_creation[enabled]']).toBeUndefined();
  });
  it('client déjà connu de Stripe : on le réutilise', () => {
    const f = Object.fromEntries(corpsCommande({ ...base, client: 'cus_1', tarif: pack }));
    expect(f.customer).toBe('cus_1');
    expect(f.customer_email).toBeUndefined();
    expect(f.customer_creation).toBeUndefined();
  });
});
