// Ouvre une page de paiement Stripe, ou l'espace de facturation, pour le compte connecté.
//   POST { action: 'commander', tarif }   → { url } : page de paiement
//   POST { action: 'portail' }            → { url } : gestion de l'abonnement et factures
//   POST { action: 'commander_signature', edl_id } → { url } : les 5 € de la signature électronique d'un état des lieux
// Le prix est lu dans la table des tarifs : le navigateur ne donne qu'un code.
// Rien n'est crédité ici : les crédits arrivent par le message de Stripe (webhook-stripe).
//
// Coupe-circuit : en mode test, seule une clé de test Stripe est acceptée.
//
// Exécutée et testée sur la pile locale (e2e/paiement.spec.ts) ; pas encore déployée.
// Clé Stripe : saisie dans l'administration (migration 12). Secrets attendus : SITE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// STRIPE_API_URL ne sert qu'aux tests (faux Stripe local).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { TARIFS_EN_LIGNE, cleAdmise, corpsCommande, type Tarif } from '../_partage/stripe.ts';

const ORIGINE = Deno.env.get('SITE_URL') ?? 'https://constatio.fr';
const STRIPE = Deno.env.get('STRIPE_API_URL') ?? 'https://api.stripe.com';
const ENTETES = {
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });
class Refus extends Error { constructor(readonly statut: number, readonly motif: string) { super(motif); } }
const lu = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

async function stripe(cle: string, chemin: string, corps: URLSearchParams): Promise<{ url?: string }> {
  const r = await fetch(`${STRIPE}${chemin}`, { method: 'POST', headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: corps });
  const reponse = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status} : ${reponse?.error?.message ?? 'réponse illisible'}`);
  return reponse;
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const autorisation = requete.headers.get('Authorization') ?? '';
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
    const { data: qui } = await client.auth.getUser(autorisation.replace(/^Bearer\s+/i, ''));
    if (!qui?.user) throw new Refus(401, 'session');
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // Les clés sont saisies dans l'administration ; la base ne rend que celle du mode en cours.
    // (STRIPE_SECRET_KEY, variable d'environnement, ne sert plus qu'à la pile locale de test.)
    const cles = lu(await service.rpc('cles_stripe')) as { mode_test: boolean; cle: string | null };
    const modeTest = cles.mode_test;
    const cle = cles.cle ?? Deno.env.get('STRIPE_SECRET_KEY');
    const admise = cleAdmise(cle, modeTest);
    if (admise === 'absente') throw new Refus(503, 'ferme');
    if (admise !== 'ok') { console.error('paiement : clé Stripe refusée —', admise); throw new Refus(503, 'ferme'); }

    // Le compte de la personne connectée, lu avec ses propres droits.
    const membre = lu(await client.from('organisation_membres').select('organisation_id').eq('user_id', qui.user.id).limit(1).maybeSingle());
    if (!membre) throw new Refus(403, 'compte');
    const org = membre.organisation_id as string;
    const corps = await requete.json().catch(() => ({}));
    const connu = lu(await service.rpc('stripe_client', { p_org: org })) as string | null;

    if (corps.action === 'portail') {
      if (!connu) throw new Refus(409, 'sans_achat');
      const s = await stripe(cle!, '/v1/billing_portal/sessions', new URLSearchParams({ customer: connu, return_url: `${ORIGINE}/app/credits` }));
      return json(200, { statut: 'ok', url: s.url });
    }
    if (corps.action === 'commander') {
      if (typeof corps.tarif !== 'string' || !TARIFS_EN_LIGNE.includes(corps.tarif)) throw new Refus(400, 'tarif');
      const tarif = lu(await service.from('tarifs').select('code, libelle, montant_cents, periodicite, credits, actif').eq('code', corps.tarif).maybeSingle()) as (Tarif & { actif: boolean }) | null;
      if (!tarif?.actif || tarif.montant_cents <= 0) throw new Refus(400, 'tarif');
      if (tarif.periodicite === 'mensuel') {
        const enCours = lu(await service.from('abonnements').select('id').eq('organisation_id', org).in('statut', ['actif', 'impaye']).gt('periode_fin', new Date().toISOString()).limit(1));
        if (enCours?.length) throw new Refus(409, 'deja_abonne');
      }
      const s = await stripe(cle!, '/v1/checkout/sessions', corpsCommande({ tarif, organisationId: org, email: qui.user.email ?? null, client: connu, origine: ORIGINE }));
      if (!s.url) throw new Error('Stripe : page de paiement sans adresse');
      return json(200, { statut: 'ok', url: s.url, essai: modeTest });
    }
    if (corps.action === 'commander_signature') {
      // Les 5 € de la signature électronique d'un état des lieux : il doit être à ce compte, généré, et pas encore signé.
      if (typeof corps.edl_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(corps.edl_id)) throw new Refus(400, 'demande');
      const edl = lu(await client.from('edl').select('id, organisation_id, statut, pdf_path').eq('id', corps.edl_id).maybeSingle());
      if (!edl || edl.organisation_id !== org) throw new Refus(404, 'introuvable');
      if (edl.statut !== 'termine' || !edl.pdf_path) throw new Refus(409, 'document');
      if (lu(await service.from('edl_signature_electronique').select('edl_id').eq('edl_id', edl.id).maybeSingle())) throw new Refus(409, 'deja_paye');
      if ((lu(await service.from('edl_signatures').select('id').eq('edl_id', edl.id).limit(1)) ?? []).length) throw new Refus(409, 'deja_signe');
      const tarif = lu(await service.from('tarifs').select('code, libelle, montant_cents, periodicite, credits, actif').eq('code', 'signature_electronique').maybeSingle()) as (Tarif & { actif: boolean }) | null;
      if (!tarif?.actif || tarif.montant_cents <= 0) throw new Refus(400, 'tarif');
      const s = await stripe(cle!, '/v1/checkout/sessions', corpsCommande({ tarif, organisationId: org, email: qui.user.email ?? null, client: connu, origine: ORIGINE, edlId: edl.id }));
      if (!s.url) throw new Error('Stripe : page de paiement sans adresse');
      return json(200, { statut: 'ok', url: s.url, essai: modeTest });
    }
    throw new Refus(400, 'demande');
  } catch (e) {
    if (e instanceof Refus) return json(e.statut, { statut: 'refuse', motif: e.motif });
    console.error('paiement', e);
    return json(500, { statut: 'erreur' });
  }
});
