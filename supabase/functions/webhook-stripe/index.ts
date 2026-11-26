// Réception des messages de Stripe (paiement encaissé, échéance, résiliation, remboursement).
// Ce fichier ne fait que vérifier la signature ; tout le traitement est dans la base
// (stripe_recevoir, migration 10), atomique et testé.
// Réponses : 200 = pris en compte (ou sans objet) ; 400 = signature refusée ;
// 500 = échec de traitement, Stripe renverra le message.
//
// Exécutée et testée sur la pile locale (e2e/paiement.spec.ts) ; pas encore déployée.
// À déployer sans vérification de session (verify_jwt = false).
// Secret du webhook : saisi dans l'administration (migration 12). Secrets attendus : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifierStripe } from '../_partage/stripe.ts';

const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (requete) => {
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // Secrets saisis dans l'administration (test et réel) ; la variable d'environnement ne sert qu'à la pile locale.
  const cles = await service.rpc('cles_stripe');
  const secrets = [...((cles.data?.webhooks as string[] | undefined) ?? []), Deno.env.get('STRIPE_WEBHOOK_SECRET')].filter((s): s is string => !!s);
  if (!secrets.length) return json(503, { statut: 'indisponible' });
  const corps = await requete.text();
  // Signé par l'un ou l'autre : c'est ensuite la base qui écarte un message « réel » en mode test, et inversement.
  let verdict: string = 'fausse';
  for (const secret of secrets) {
    verdict = await verifierStripe(secret, corps, requete.headers.get('Stripe-Signature'));
    if (verdict !== 'fausse') break;
  }
  if (verdict !== 'valide') return json(400, { statut: 'refuse', motif: `signature_${verdict}` });
  let message: unknown;
  try { message = JSON.parse(corps); } catch { return json(400, { statut: 'refuse', motif: 'illisible' }); }
  const { data, error } = await service.rpc('stripe_recevoir', { p_message: message });
  if (error) { console.error('webhook-stripe', error.message); return json(500, { statut: 'erreur' }); }
  if (data === 'erreur') return json(500, { statut: 'erreur' });
  return json(200, { statut: 'ok', issue: data });
});
