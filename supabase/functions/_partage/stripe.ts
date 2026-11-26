// Échanges avec Stripe, sans bibliothèque : une commande est un formulaire envoyé à
// son API, un message reçu se vérifie par sa signature. Fonctions pures, testées.
//   En-tête des messages : Stripe-Signature: t=<secondes>,v1=<HMAC-SHA256 hex de « t.corps »>[,v1=…]

export const TOLERANCE_SECONDES = 300;

const hex = (octets: ArrayBuffer) => [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, '0')).join('');
async function hmac(secret: string, message: string): Promise<string> {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message)));
}
function egales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

export async function signerStripe(secret: string, corps: string, maintenant = Date.now()): Promise<string> {
  const t = Math.floor(maintenant / 1000);
  return `t=${t},v1=${await hmac(secret, `${t}.${corps}`)}`;
}

export type Verdict = 'valide' | 'absente' | 'illisible' | 'perimee' | 'fausse';
export async function verifierStripe(secret: string, corps: string, entete: string | null, maintenant = Date.now()): Promise<Verdict> {
  if (!entete) return 'absente';
  const champs = entete.split(',').map((x) => x.trim().split('='));
  const t = Number(champs.find(([k]) => k === 't')?.[1]);
  // Pendant un renouvellement de secret, Stripe envoie plusieurs signatures : une seule doit convenir.
  const signatures = champs.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')).map(([, v]) => v);
  if (!Number.isInteger(t) || !signatures.length) return 'illisible';
  if (Math.abs(maintenant / 1000 - t) > TOLERANCE_SECONDES) return 'perimee';
  const attendue = await hmac(secret, `${t}.${corps}`);
  return signatures.some((s) => egales(s, attendue)) ? 'valide' : 'fausse';
}

/**
 * Coupe-circuit. En mode test, seule une clé de test Stripe est acceptée : aucun
 * paiement réel ne peut partir. En mode réel, une clé de test serait une erreur de réglage.
 */
export function cleAdmise(cle: string | undefined, modeTest: boolean): 'ok' | 'absente' | 'reelle_en_mode_test' | 'test_en_mode_reel' {
  if (!cle) return 'absente';
  const deTest = /^(sk|rk)_test_/.test(cle);
  if (modeTest) return deTest ? 'ok' : 'reelle_en_mode_test';
  return deTest ? 'test_en_mode_reel' : 'ok';
}

export interface Tarif { code: string; libelle: string; montant_cents: number; periodicite: 'unique' | 'mensuel'; credits: number }
/** Ce qui se vend en ligne. L'offre groupée se vend chez Signabail ; la prestation sur place, sur rendez-vous. */
export const TARIFS_EN_LIGNE = ['edl_unite', 'pack_entree_sortie', 'pack_5', 'pack_10', 'premium_investisseur', 'premium_pro'];

export interface Commande { tarif: Tarif; organisationId: string; email: string | null; client: string | null; origine: string; /** Achat rattaché à un état des lieux (signature électronique) : on y revient après le paiement. */ edlId?: string }
/** Le formulaire de création d'une page de paiement Stripe. Le prix vient de la table des tarifs, jamais du navigateur. */
export function corpsCommande(c: Commande): URLSearchParams {
  const abonnement = c.tarif.periodicite === 'mensuel';
  const f = new URLSearchParams({
    mode: abonnement ? 'subscription' : 'payment',
    locale: 'fr',
    success_url: c.edlId ? `${c.origine}/app/edl/${c.edlId}/apercu?signature=payee` : `${c.origine}/app/credits?paiement=ok`,
    cancel_url: c.edlId ? `${c.origine}/app/edl/${c.edlId}/apercu` : `${c.origine}/app/credits?paiement=annule`,
    client_reference_id: c.organisationId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(c.tarif.montant_cents),
    'line_items[0][price_data][product_data][name]': `Constatio — ${c.tarif.libelle}`,
    'metadata[organisation_id]': c.organisationId,
    'metadata[tarif_code]': c.tarif.code,
  });
  if (abonnement) {
    f.set('line_items[0][price_data][recurring][interval]', 'month');
    f.set('subscription_data[metadata][organisation_id]', c.organisationId);
    f.set('subscription_data[metadata][tarif_code]', c.tarif.code);
  } else {
    f.set('invoice_creation[enabled]', 'true');
    f.set('payment_intent_data[metadata][organisation_id]', c.organisationId);
    f.set('payment_intent_data[metadata][tarif_code]', c.tarif.code);
    if (!c.client) f.set('customer_creation', 'always');
  }
  if (c.edlId) { f.set('metadata[edl_id]', c.edlId); f.set('payment_intent_data[metadata][edl_id]', c.edlId); }
  if (c.client) f.set('customer', c.client);
  else if (c.email) f.set('customer_email', c.email);
  return f;
}
