// Signature électronique d'un état des lieux.
//   Avec la session d'un membre de l'organisation :
//     { action: 'signer',   edl_id, partie_id, image }  signature sur place, sur cet appareil
//     { action: 'lien',     edl_id, partie_id }         lien personnel de signature à distance
//     { action: 'cloturer', edl_id }                    reprise si le dépôt de l'exemplaire signé a échoué
//     { action: 'electronique_envoyer', edl_id }        signature électronique DocuSeal : envoi aux parties (après paiement)
//     { action: 'electronique_relever', edl_id }        où en est la demande ; rapatrie le document signé
//   Tâche planifiée (secret de la base) :
//     { action: 'electronique_relever_tout' }           relève toutes les demandes DocuSeal en cours
//   Sans session, avec le jeton du lien (seule son empreinte est en base) :
//     { action: 'consulter',   jeton }                  ce que la personne va signer
//     { action: 'signer_lien', jeton, image }           sa signature
// Chaque signature porte sur l'empreinte du document définitif ; l'adresse IP et
// l'appareil sont relevés ici, jamais déclarés par le navigateur. Quand la
// dernière signature arrive, l'exemplaire signé (signatures + dossier de preuve)
// est construit et l'état des lieux devient « signé ».
//
// Exécutée et testée sur la pile locale (e2e/signature.spec.ts) ; pas encore déployée.
// À déployer sans vérification de session (verify_jwt = false) : les liens n'en ont pas.
// Secrets attendus : SITE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { empreintePdf, type CaseSignature } from '../_partage/pdf.ts';
import { signerPdf, type SignaturePosee } from '../_partage/pdf-signe.ts';
import { creerDemande, etatDemande, statutDepuisPrestataire, telechargerSigne, type Signataire } from '../_partage/docuseal.ts';

const ORIGINE = Deno.env.get('SITE_URL') ?? 'https://constatio.fr';
const ENTETES = {
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: Record<string, string> = { bailleur: 'Bailleur', locataire: 'Locataire', mandataire_bailleur: 'Mandataire du bailleur', mandataire_locataire: 'Mandataire du locataire' };
const IMAGE_MAX = 400_000; // octets : un tracé pèse quelques dizaines de ko

class Refus extends Error { constructor(readonly statut: number, readonly motif: string) { super(motif); } }
const lu = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const hex = (o: ArrayBuffer) => [...new Uint8Array(o)].map((x) => x.toString(16).padStart(2, '0')).join('');
const empreinteJeton = async (jeton: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton)));
const nom = (p: { civilite: string | null; prenom: string; nom: string }) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');

/** Le tracé : un PNG, et rien d'autre. */
function image(b64: unknown): Uint8Array {
  if (typeof b64 !== 'string' || b64.length > IMAGE_MAX * 1.4) throw new Refus(400, 'image');
  let octets: Uint8Array;
  try { octets = Uint8Array.from(atob(b64.replace(/^data:image\/png;base64,/, '')), (c) => c.charCodeAt(0)); } catch { throw new Refus(400, 'image'); }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length < 200 || octets.length > IMAGE_MAX || png.some((v, i) => octets[i] !== v)) throw new Refus(400, 'image');
  return octets;
}
function adresseIp(requete: Request): string | null {
  const ip = (requete.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
}

/** Construit et dépose l'exemplaire signé, puis clôt. Sans effet s'il reste des signatures à recueillir. */
async function cloturer(service: SupabaseClient, edlId: string): Promise<'signe' | 'en_attente'> {
  const edl = lu(await service.from('edl').select('id, organisation_id, statut, pdf_path, pdf_sha256, genere_le').eq('id', edlId).single());
  if (edl.statut === 'signe') return 'signe';
  if (edl.statut !== 'termine' || !edl.pdf_path) throw new Refus(409, 'document');
  const parties = lu(await service.from('edl_parties').select('id, role, civilite, prenom, nom, doit_signer, ordre').eq('edl_id', edlId).order('ordre')) ?? [];
  const signatures = lu(await service.from('edl_signatures').select('*').eq('edl_id', edlId)) ?? [];
  const attendues = parties.filter((p) => p.doit_signer);
  if (!attendues.length || attendues.some((p) => !signatures.some((s) => s.partie_id === p.id && s.pdf_sha256 === edl.pdf_sha256))) return 'en_attente';

  const fichier = await service.storage.from('edl').download(edl.pdf_path);
  if (!fichier.data) throw new Error(`document illisible : ${fichier.error?.message}`);
  const original = new Uint8Array(await fichier.data.arrayBuffer());
  // On ne signe que le document dont l'empreinte est conservée.
  if ((await empreintePdf(original)) !== edl.pdf_sha256) throw new Error('le document déposé ne correspond plus à son empreinte');
  const journal = lu(await service.from('edl_journal').select('details').eq('edl_id', edlId).eq('evenement', 'pdf_genere').order('id', { ascending: false }).limit(5)) ?? [];
  const cases = (journal.find((j) => j.details?.pdf_sha256 === edl.pdf_sha256)?.details?.cases ?? []) as CaseSignature[];

  const posees: SignaturePosee[] = [];
  for (const p of attendues) {
    const s = signatures.find((x) => x.partie_id === p.id)!;
    const trace = s.image_path ? await service.storage.from('edl').download(s.image_path) : null;
    posees.push({ partie_id: p.id, qualite: ROLES[p.role] ?? p.role, nom: nom(p), mode: s.mode, signe_le: s.signe_le, ip: s.ip, appareil: s.user_agent,
      image: trace?.data ? new Uint8Array(await trace.data.arrayBuffer()) : null });
  }
  const modeTest = lu(await service.from('parametres').select('valeur').eq('cle', 'mode_test').maybeSingle());
  const org = lu(await service.from('organisations').select('est_test').eq('id', edl.organisation_id).maybeSingle());
  const essai = String(modeTest?.valeur) !== 'false' || !!org?.est_test;

  const signe = await signerPdf(original, cases, { empreinte: edl.pdf_sha256, genere_le: edl.genere_le, signatures: posees, essai });
  const sha = await empreintePdf(signe);
  const chemin = `${edl.organisation_id}/${edlId}/pdf/signe-${sha.slice(0, 16)}.pdf`;
  const depot = await service.storage.from('edl').upload(chemin, signe, { contentType: 'application/pdf', upsert: true });
  if (depot.error) throw new Error(`dépôt : ${depot.error.message}`);
  lu(await service.rpc('edl_cloturer_signatures', { p_edl: edlId, p_chemin: chemin, p_sha256: sha }));
  return 'signe';
}

async function poser(service: SupabaseClient, requete: Request, o: { edl: string; organisation: string; partie: string; mode: 'sur_place' | 'a_distance'; trace: Uint8Array; acteur: string | null; jetonHash: string | null }) {
  const chemin = `${o.organisation}/${o.edl}/signatures/${o.partie}.png`;
  const depot = await service.storage.from('edl').upload(chemin, o.trace, { contentType: 'image/png', upsert: true });
  if (depot.error) throw new Error(`dépôt du tracé : ${depot.error.message}`);
  const r = await service.rpc('edl_signer', { p_edl: o.edl, p_partie: o.partie, p_mode: o.mode, p_image: chemin, p_ip: adresseIp(requete),
    p_appareil: requete.headers.get('user-agent') ?? '', p_acteur: o.acteur, p_jeton_hash: o.jetonHash });
  if (r.error) {
    if (r.error.code === 'CS001') throw new Refus(409, 'deja_signe');
    if (r.error.code === 'CS002') throw new Refus(410, 'lien');
    if (r.error.code === 'P0001') throw new Refus(409, 'document');
    throw new Error(r.error.message);
  }
  let statut: 'signe' | 'en_attente' = 'en_attente';
  // La signature est acquise même si la clôture échoue : elle se reprend (action « cloturer »).
  if (r.data === 0) { try { statut = await cloturer(service, o.edl); } catch (e) { console.error('signature : clôture en échec', e); } }
  return { statut: 'ok', reste: r.data as number, edl: statut };
}

/** Où en est une demande chez DocuSeal ? Signée partout : le document est rapatrié et l'état des lieux clos. */
async function releverDemande(service: SupabaseClient, cles: { cle: string | null; url: string }, edl: { id: string; organisation_id: string }, demande: string | null) {
  if (!demande) return { statut: 'ok', edl: 'payee' };
  if (demande.startsWith('test-')) return { statut: 'ok', edl: 'en_signature', retenue: true };
  if (!cles.cle) throw new Refus(503, 'ferme');
  const cfg = { cle: cles.cle, url: cles.url };
  const etat = await etatDemande(cfg, demande);
  const ou = statutDepuisPrestataire(etat.statut);
  if (ou === 'annulee') { lu(await service.rpc('edl_signature_annulee', { p_edl: edl.id })); return { statut: 'ok', edl: 'payee', annulee: true }; }
  if (ou === 'en_signature') return { statut: 'ok', edl: 'en_signature', signataires: etat.signataires };
  const signe = await telechargerSigne(cfg, demande);
  const sha = await empreintePdf(signe);
  const chemin = `${edl.organisation_id}/${edl.id}/pdf/signe-docuseal-${sha.slice(0, 16)}.pdf`;
  const depot = await service.storage.from('edl').upload(chemin, signe, { contentType: 'application/pdf', upsert: true });
  if (depot.error) throw new Error(`dépôt : ${depot.error.message}`);
  lu(await service.rpc('edl_clore_electronique', { p_edl: edl.id, p_chemin: chemin, p_sha256: sha }));
  return { statut: 'ok', edl: 'signe' };
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const corps = await requete.json().catch(() => ({}));

    // ── Tâche planifiée : relève de toutes les demandes DocuSeal en cours ────────────
    // Appelée par la base toutes les dix minutes, avec un secret qu'elle seule connaît.
    if (corps.action === 'electronique_relever_tout') {
      const attendu = lu(await service.rpc('cle_releve')) as string | null;
      if (!attendu || requete.headers.get('x-releve') !== attendu) throw new Refus(401, 'session');
      const cles = lu(await service.rpc('cles_docuseal')) as { mode_test: boolean; cle: string | null; url: string };
      if (cles.mode_test || !cles.cle) return json(200, { statut: 'ok', relevees: 0, signees: 0, echecs: 0 });
      const enCours = lu(await service.from('edl_signature_electronique').select('edl_id, demande_id, edl:edl_id(organisation_id)').eq('statut', 'en_signature').not('demande_id', 'is', null).order('updated_at').limit(50)) ?? [];
      let signees = 0, echecs = 0;
      for (const s of enCours) {
        // Une demande en échec n'arrête pas les suivantes.
        try { if ((await releverDemande(service, cles, { id: s.edl_id, organisation_id: (s.edl as unknown as { organisation_id: string }).organisation_id }, s.demande_id)).edl === 'signe') signees++; }
        catch (e) { echecs++; console.error('signature : relève en échec', s.edl_id, e instanceof Error ? e.message : e); }
      }
      return json(200, { statut: 'ok', relevees: enCours.length, signees, echecs });
    }

    // ── Lien du document signé : l'exemplaire signé et les photos des réserves ─────────
    if (corps.action === 'dossier') {
      if (typeof corps.jeton !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(corps.jeton)) throw new Refus(410, 'lien');
      const jeton = lu(await service.from('edl_jetons').select('edl_id, expire_le').eq('jeton_hash', await empreinteJeton(corps.jeton)).eq('usage', 'complement').maybeSingle());
      if (!jeton || new Date(jeton.expire_le) < new Date()) throw new Refus(410, 'lien');
      const edl = lu(await service.from('edl').select('statut, pdf_signe_path').eq('id', jeton.edl_id).single());
      if (edl.statut !== 'signe') throw new Refus(410, 'lien');
      const relatif = (adresse: string) => new URL(adresse).pathname.replace(/^\/storage\/v1/, '') + new URL(adresse).search;
      const signe = edl.pdf_signe_path ? await service.storage.from('edl').createSignedUrl(edl.pdf_signe_path, 900) : null;
      const reserves = lu(await service.from('edl_complements').select('photo_paths').eq('edl_id', jeton.edl_id).eq('type', 'general')) ?? [];
      const chemins = reserves.flatMap((r) => (r.photo_paths ?? []) as string[]);
      const photos: Record<string, string> = {};
      if (chemins.length) for (const p of (await service.storage.from('edl').createSignedUrls(chemins, 900)).data ?? []) if (p.path && p.signedUrl) photos[p.path] = relatif(p.signedUrl);
      return json(200, { statut: 'ok', document: signe?.data?.signedUrl ? relatif(signe.data.signedUrl) : null, photos });
    }

    // ── Avec le jeton d'un lien ────────────────────────────────────────────────
    if (corps.action === 'consulter' || corps.action === 'signer_lien') {
      if (typeof corps.jeton !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(corps.jeton)) throw new Refus(410, 'lien');
      const hash = await empreinteJeton(corps.jeton);
      const jeton = lu(await service.from('edl_jetons').select('edl_id, partie_id, expire_le, utilise_le').eq('jeton_hash', hash).eq('usage', 'signature').maybeSingle());
      // Un lien utilisé reste consultable trente jours : la personne y retrouve son exemplaire.
      if (!jeton || (!jeton.utilise_le && new Date(jeton.expire_le) < new Date())
        || (jeton.utilise_le && Date.now() - new Date(jeton.utilise_le).getTime() > 30 * 86_400_000)) throw new Refus(410, 'lien');
      const edl = lu(await service.from('edl').select('id, organisation_id, logement_id, type, statut, date_edl, pdf_path, pdf_sha256, pdf_signe_path').eq('id', jeton.edl_id).single());
      if (corps.action === 'signer_lien') {
        if (corps.lu !== true) throw new Refus(400, 'lecture');
        return json(200, await poser(service, requete, { edl: edl.id, organisation: edl.organisation_id, partie: jeton.partie_id, mode: 'a_distance', trace: image(corps.image), acteur: null, jetonHash: hash }));
      }
      const logement = lu(await service.from('logements').select('adresse, code_postal, ville').eq('id', edl.logement_id).single());
      const parties = lu(await service.from('edl_parties').select('id, role, civilite, prenom, nom, doit_signer, ordre').eq('edl_id', edl.id).order('ordre')) ?? [];
      const signatures = lu(await service.from('edl_signatures').select('partie_id, signe_le').eq('edl_id', edl.id)) ?? [];
      const moi = parties.find((p) => p.id === jeton.partie_id)!;
      const chemin = edl.statut === 'signe' ? edl.pdf_signe_path : edl.pdf_path;
      const lien = chemin ? await service.storage.from('edl').createSignedUrl(chemin, 900) : null;
      const modeTest = lu(await service.from('parametres').select('valeur').eq('cle', 'mode_test').maybeSingle());
      return json(200, {
        statut: 'ok', essai: String(modeTest?.valeur) !== 'false',
        edl: { type: edl.type, statut: edl.statut, date_edl: edl.date_edl, adresse: `${logement.adresse}, ${logement.code_postal} ${logement.ville}`, pdf_sha256: edl.pdf_sha256 },
        // Adresse relative : le navigateur la complète avec celle du service.
        document: lien?.data?.signedUrl ? new URL(lien.data.signedUrl).pathname.replace(/^\/storage\/v1/, '') + new URL(lien.data.signedUrl).search : null,
        moi: { qualite: ROLES[moi.role] ?? moi.role, nom: nom(moi), signe_le: signatures.find((s) => s.partie_id === moi.id)?.signe_le ?? null },
        signataires: parties.filter((p) => p.doit_signer).map((p) => ({ qualite: ROLES[p.role] ?? p.role, nom: nom(p), signe: signatures.some((s) => s.partie_id === p.id) })),
      });
    }

    // ── Avec la session d'un membre ─────────────────────────────────────────────
    const autorisation = requete.headers.get('Authorization') ?? '';
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
    const { data: qui } = await client.auth.getUser(autorisation.replace(/^Bearer\s+/i, ''));
    if (!qui?.user) throw new Refus(401, 'session');
    if (typeof corps.edl_id !== 'string' || !UUID.test(corps.edl_id)) throw new Refus(400, 'demande');
    // Lu avec les droits de l'utilisateur. Un état des lieux non signé n'est visible que de son organisation.
    const edl = lu(await client.from('edl').select('id, organisation_id, statut').eq('id', corps.edl_id).maybeSingle());
    if (!edl) throw new Refus(404, 'introuvable');
    if (corps.action === 'cloturer') return json(200, { statut: 'ok', edl: await cloturer(service, edl.id) });

    // ── Signature électronique par DocuSeal (5 € par état des lieux, réglés avant) ─────
    if (corps.action === 'electronique_envoyer' || corps.action === 'electronique_relever') {
      const suivi = lu(await service.from('edl_signature_electronique').select('statut, demande_id').eq('edl_id', edl.id).maybeSingle());
      if (!suivi) throw new Refus(402, 'non_payee');
      if (edl.statut === 'signe' || suivi.statut === 'signee') return json(200, { statut: 'ok', edl: 'signe' });
      const cles = lu(await service.rpc('cles_docuseal')) as { mode_test: boolean; cle: string | null; url: string };
      const complet = lu(await service.from('edl').select('id, organisation_id, type, date_edl, pdf_path, pdf_sha256, logement_id').eq('id', edl.id).single());

      if (corps.action === 'electronique_envoyer') {
        if (suivi.demande_id) throw new Refus(409, 'deja_envoyee');
        const parties = (lu(await service.from('edl_parties').select('id, role, civilite, prenom, nom, email, doit_signer, ordre').eq('edl_id', edl.id).order('ordre')) ?? []).filter((p) => p.doit_signer);
        // Chaque signataire reçoit son lien par e-mail : il lui faut une adresse, et elles doivent être distinctes.
        const adresses = parties.map((p) => String(p.email ?? '').trim().toLowerCase());
        if (!parties.length || adresses.some((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) || new Set(adresses).size !== adresses.length) throw new Refus(422, 'emails');
        const signataires: Signataire[] = parties.map((p, i) => ({ partie_id: p.id, role: `${ROLES[p.role] ?? p.role} ${i + 1}`, nom: nom(p), email: adresses[i] }));
        if (cles.mode_test) {
          // Coupe-circuit : en mode test, rien ne part chez le prestataire ni dans les boîtes des parties.
          lu(await service.rpc('edl_signature_demandee', { p_edl: edl.id, p_demande: `test-${Date.now()}`, p_liens: [], p_acteur: qui.user.id }));
          return json(200, { statut: 'ok', edl: 'en_signature', retenue: true });
        }
        if (!cles.cle) throw new Refus(503, 'ferme');
        const fichier = await service.storage.from('edl').download(complet.pdf_path);
        if (!fichier.data) throw new Error(`document illisible : ${fichier.error?.message}`);
        const pdf = new Uint8Array(await fichier.data.arrayBuffer());
        if ((await empreintePdf(pdf)) !== complet.pdf_sha256) throw new Error('le document déposé ne correspond plus à son empreinte');
        const journal = lu(await service.from('edl_journal').select('details').eq('edl_id', edl.id).eq('evenement', 'pdf_genere').order('id', { ascending: false }).limit(5)) ?? [];
        const cases = (journal.find((j) => j.details?.pdf_sha256 === complet.pdf_sha256)?.details?.cases ?? []) as CaseSignature[];
        const logement = lu(await service.from('logements').select('adresse, code_postal, ville').eq('id', complet.logement_id).single());
        const quoi = `${complet.type === 'sortant' ? 'État des lieux de sortie' : complet.type === 'entrant' ? 'État des lieux d’entrée' : 'Relevé d’état'} — ${logement.adresse}, ${logement.code_postal} ${logement.ville}`;
        const demande = await creerDemande({ cle: cles.cle, url: cles.url }, { nom: quoi, pdf, signataires, cases, message: {
          subject: `${quoi} : votre signature`,
          body: `Bonjour,\n\nVous êtes invité(e) à lire et signer le document suivant : ${quoi}.\n\nLisez-le en entier avant de signer. Si un point ne correspond pas à ce que vous avez constaté, ne signez pas et demandez sa correction.\n\n{{submitter.link}}\n\nCe message vous est envoyé par Constatio pour le compte de la personne qui a réalisé l’état des lieux.` } });
        lu(await service.rpc('edl_signature_demandee', { p_edl: edl.id, p_demande: demande.id, p_liens: demande.liens, p_acteur: qui.user.id }));
        return json(200, { statut: 'ok', edl: 'en_signature', liens: demande.liens });
      }

      return json(200, await releverDemande(service, cles, { id: edl.id, organisation_id: complet.organisation_id }, suivi.demande_id));
    }
    if (edl.statut !== 'termine') throw new Refus(409, edl.statut === 'signe' ? 'signe' : 'document');
    if (typeof corps.partie_id !== 'string' || !UUID.test(corps.partie_id)) throw new Refus(400, 'demande');

    if (corps.action === 'signer' || corps.action === 'lien') {
      const enCours = lu(await service.from('edl_signature_electronique').select('demande_id').eq('edl_id', edl.id).maybeSingle());
      if (enCours?.demande_id) throw new Refus(409, 'electronique_en_cours');
    }
    if (corps.action === 'signer') {
      if (corps.lu !== true) throw new Refus(400, 'lecture');
      return json(200, await poser(service, requete, { edl: edl.id, organisation: edl.organisation_id, partie: corps.partie_id, mode: 'sur_place', trace: image(corps.image), acteur: qui.user.id, jetonHash: null }));
    }
    if (corps.action === 'lien') {
      const alea = crypto.getRandomValues(new Uint8Array(32));
      const jeton = btoa(String.fromCharCode(...alea)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const r = await service.rpc('edl_creer_jeton_signature', { p_edl: edl.id, p_partie: corps.partie_id, p_jeton_hash: await empreinteJeton(jeton), p_acteur: qui.user.id });
      if (r.error) { if (r.error.code === 'CS001') throw new Refus(409, 'deja_signe'); if (r.error.code === 'P0001') throw new Refus(409, 'document'); throw new Error(r.error.message); }
      return json(200, { statut: 'ok', lien: `${ORIGINE}/signer/${jeton}`, expire_le: r.data });
    }
    throw new Refus(400, 'demande');
  } catch (e) {
    if (e instanceof Refus) return json(e.statut, { statut: 'refuse', motif: e.motif });
    console.error('signature', e);
    return json(500, { statut: 'erreur' });
  }
});
