// Arrivée du lien de passage Signabail → Constatio.
//   { jeton }        : ouvre une session (compte relié ou créé), ou demande une confirmation.
//   { attestation }  : la personne s'est connectée à Constatio ; on relie son compte.
// Toute la décision est dans ../_partage/passage.ts (testée) ; ce fichier ne fait
// que la brancher sur Supabase.
//
// NON ENCORE DÉPLOYÉE NI EXÉCUTÉE : le projet Supabase n'existe pas.
// Secrets attendus : SIGNABAIL_WEBHOOK_SECRET (le même que pour les messages),
// SITE_URL (origine autorisée), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { traiterPassage, traiterRattachement, type Annuaire } from '../_partage/passage.ts';

const ORIGINE = Deno.env.get('SITE_URL') ?? 'https://constatio.fr';
const ENTETES = {
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  const secret = Deno.env.get('SIGNABAIL_WEBHOOK_SECRET');
  if (!secret) return json(500, { statut: 'erreur' });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const echec = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  const annuaire: Annuaire = {
    async emailDuCompteRelie(compte) {
      const org = echec(await service.from('organisations').select('id').eq('signabail_compte_id', compte).maybeSingle());
      if (!org) return null;
      const membre = echec(await service.from('organisation_membres').select('user_id').eq('organisation_id', org.id).eq('role', 'proprietaire').limit(1).maybeSingle());
      if (!membre) return null;
      return echec(await service.auth.admin.getUserById(membre.user_id)).user?.email ?? null;
    },
    async utilisateurExiste(email) {
      return !!echec(await service.rpc('utilisateur_par_email', { p_email: email }));
    },
    async creerUtilisateur(email) {
      // Adresse tenue pour confirmée : Signabail a authentifié la personne, et aucun compte Constatio ne la portait.
      const cree = echec(await service.auth.admin.createUser({ email, email_confirm: true, user_metadata: { origine: 'signabail' } }));
      const membre = echec(await service.from('organisation_membres').select('organisation_id').eq('user_id', cree.user!.id).single());
      return membre.organisation_id;
    },
    async rattacher(organisationId, compte) {
      echec(await service.rpc('signabail_rattacher', { p_organisation: organisationId, p_compte: compte }));
    },
    async ouvrirSession(email) {
      return echec(await service.auth.admin.generateLink({ type: 'magiclink', email })).properties!.hashed_token;
    },
    async edlDuBail(compte, bail) {
      const org = echec(await service.from('organisations').select('id').eq('signabail_compte_id', compte).maybeSingle());
      if (!org) return null;
      return echec(await service.from('edl').select('id').eq('organisation_id', org.id).eq('signabail_bail_id', bail).limit(1).maybeSingle())?.id ?? null;
    },
  };

  try {
    const corps = await requete.json().catch(() => ({}));
    if (corps.attestation !== undefined) {
      // La personne doit être connectée à Constatio : c'est SON organisation que l'on relie.
      const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: requete.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
      });
      const { data } = await client.auth.getUser();
      if (!data.user?.email) return json(401, { statut: 'refuse', motif: 'connexion' });
      const membre = echec(await service.from('organisation_membres').select('organisation_id').eq('user_id', data.user.id).eq('role', 'proprietaire').limit(1).maybeSingle());
      if (!membre) return json(403, { statut: 'refuse', motif: 'connexion' });
      return json(200, await traiterRattachement(secret, corps.attestation, { email: data.user.email, organisationId: membre.organisation_id }, annuaire));
    }
    return json(200, await traiterPassage(secret, corps.jeton, annuaire));
  } catch (e) {
    console.error('passage-signabail', e instanceof Error ? e.message : e);
    return json(500, { statut: 'erreur' });
  }
});
