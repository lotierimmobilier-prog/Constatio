// Réception des messages de Signabail (bail signé, bail annulé, offre groupée…).
// Ne fait que deux choses : vérifier que le message vient bien de Signabail,
// puis le confier à la base (signabail_recevoir), qui porte toute la logique.
//
// Le secret partagé avec Signabail se saisit dans l'administration (clé « signabail_secret »).
// Variables d'environnement :
//   SIGNABAIL_WEBHOOK_SECRET   le même secret, pour le banc d'essai local seulement
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   fournis par Supabase
//
// Exécutée et testée sur la pile locale (e2e/signabail.spec.ts) ; pas encore déployée. La
// vérification de signature et le traitement en base sont testés séparément.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifier } from '../_partage/signature.ts';

const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (requete) => {
  if (requete.method !== 'POST') return json(405, { erreur: 'methode_refusee' });
  const base = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // Le secret partagé se saisit dans l'administration ; la variable d'environnement ne sert qu'au banc d'essai local.
  const secret = ((await base.rpc('cle_signabail')).data as string | null) ?? Deno.env.get('SIGNABAIL_WEBHOOK_SECRET');
  if (!secret) return json(503, { erreur: 'liaison_non_reglee' });

  // La signature porte sur le corps exact reçu : on le lit en texte, avant toute interprétation.
  const corps = await requete.text();
  const verdict = await verifier(secret, corps, requete.headers.get('X-Partenaire-Signature'));
  if (verdict !== 'valide') return json(401, { erreur: `signature_${verdict}` });

  let message: unknown;
  try {
    message = JSON.parse(corps);
  } catch {
    return json(400, { erreur: 'json_invalide' });
  }

  const { data, error } = await base.rpc('signabail_recevoir', { p: message });
  if (error) {
    // 22023 : message incomplet, inutile de le renvoyer. Tout le reste : Signabail réessaiera.
    console.error('signabail_recevoir', error.code, error.message);
    return json(error.code === '22023' ? 400 : 500, { erreur: error.code === '22023' ? 'message_incomplet' : 'traitement_impossible' });
  }
  return json(200, { resultat: data });
});
