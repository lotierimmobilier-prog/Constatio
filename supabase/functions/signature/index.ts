// Signature électronique d'un état des lieux.
//   Avec la session d'un membre de l'organisation :
//     { action: 'signer',   edl_id, partie_id, image }  signature sur place, sur cet appareil
//     { action: 'lien',     edl_id, partie_id }         lien personnel de signature à distance
//     { action: 'cloturer', edl_id }                    reprise si le dépôt de l'exemplaire signé a échoué
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

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const corps = await requete.json().catch(() => ({}));

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
    if (edl.statut !== 'termine') throw new Refus(409, edl.statut === 'signe' ? 'signe' : 'document');
    if (typeof corps.partie_id !== 'string' || !UUID.test(corps.partie_id)) throw new Refus(400, 'demande');

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
