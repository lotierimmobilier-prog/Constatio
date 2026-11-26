// Génère le document définitif d'un état des lieux.
//   POST { edl_id }  avec la session de l'utilisateur.
// Le serveur ne croit pas le navigateur : il relit les données (avec les droits de
// l'utilisateur), refait les contrôles, décompte le crédit, puis construit le PDF
// avec le même moteur que l'aperçu, le dépose et en conserve l'empreinte SHA-256.
//
// Ordre voulu : contrôles → crédit (qui fige l'état des lieux) → relecture → PDF →
// dépôt. Si le dépôt échoue après le crédit, l'état des lieux reste « terminé »
// sans document : un nouvel appel reprend là, sans second crédit.
//
// Exécutée et testée sur la pile locale (e2e/pdf.spec.ts) ; pas encore déployée.
// Secrets attendus : SITE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument } from 'pdf-lib';
import { controler, type DonneesControle } from '../_partage/controles.ts';
import { assembler, construireDocument, empreintePdf, type LignesEdl } from '../_partage/pdf.ts';

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

class Refus extends Error { constructor(readonly statut: number, readonly motif: string, readonly details?: unknown) { super(motif); } }
const lu = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

async function lire(client: SupabaseClient, id: string): Promise<LignesEdl | null> {
  const edl = lu(await client.from('edl').select('*').eq('id', id).maybeSingle());
  if (!edl) return null;
  const fille = async (table: string, de = id) => lu(await client.from(table).select('*').eq('edl_id', de)) ?? [];
  const [logement, organisation, parties, pieces, elements, compteurs, cles, inventaire, photos, elementsEntree] = await Promise.all([
    client.from('logements').select('*').eq('id', edl.logement_id).single().then(lu),
    client.from('organisations').select('*').eq('id', edl.organisation_id).maybeSingle().then(lu),
    fille('edl_parties'), fille('edl_pieces'), fille('edl_elements'), fille('edl_compteurs'), fille('edl_cles'), fille('edl_inventaire'), fille('edl_photos'),
    edl.entree_id ? fille('edl_elements', edl.entree_id) : Promise.resolve([]),
  ]);
  return { edl, logement, organisation, parties, pieces, elements, compteurs, cles, inventaire, photos, elementsEntree };
}

function aControler(l: LignesEdl): DonneesControle {
  return {
    type: l.edl.type,
    meuble: !!l.logement.meuble || ['meuble', 'mobilite', 'etudiant'].includes(l.edl.bail_type),
    sansCompteurs: l.logement.type_bien === 'garage',
    entreeConnue: !!l.edl.entree_id || !!l.edl.date_edl_entree,
    parties: l.parties as DonneesControle['parties'], pieces: l.pieces as DonneesControle['pieces'], elements: l.elements as DonneesControle['elements'],
    compteurs: l.compteurs as DonneesControle['compteurs'], cles: l.cles as DonneesControle['cles'], inventaire: l.inventaire as DonneesControle['inventaire'], photos: l.photos as DonneesControle['photos'],
  };
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response(null, { headers: ENTETES });
  if (requete.method !== 'POST') return json(405, { statut: 'refuse', motif: 'methode' });
  try {
    const autorisation = requete.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
    const { data: qui } = await client.auth.getUser(autorisation.replace(/^Bearer\s+/i, ''));
    if (!qui?.user) throw new Refus(401, 'session');
    const { edl_id } = await requete.json().catch(() => ({}));
    if (typeof edl_id !== 'string' || !UUID.test(edl_id)) throw new Refus(400, 'demande');

    // Lu avec les droits de l'utilisateur : ce qu'il ne peut pas voir n'existe pas pour lui.
    let lignes = await lire(client, edl_id);
    if (!lignes) throw new Refus(404, 'introuvable');
    if (lignes.edl.statut === 'signe') throw new Refus(409, 'signe');
    if (lignes.edl.statut === 'termine' && lignes.edl.pdf_path) return json(200, { statut: 'deja', pdf_path: lignes.edl.pdf_path, pdf_sha256: lignes.edl.pdf_sha256 });

    if (lignes.edl.statut === 'brouillon') {
      const bloquants = controler(aControler(lignes)).filter((a) => a.niveau === 'bloquant');
      if (bloquants.length) throw new Refus(422, 'incomplet', bloquants);
      const fin = await client.rpc('edl_finaliser', { p_edl: edl_id });
      if (fin.error) {
        if (fin.error.code === 'P0002') throw new Refus(402, 'credit');
        if (fin.error.code === '42501') throw new Refus(403, 'interdit');
        throw new Error(fin.error.message);
      }
      // Désormais figé : c'est cette lecture-là qui fait le document.
      lignes = (await lire(client, edl_id))!;
    }

    const octets = new Map<string, Uint8Array>();
    for (const p of lignes.photos) {
      const fichier = await client.storage.from('edl').download(p.storage_path);
      if (fichier.data) octets.set(p.id, new Uint8Array(await fichier.data.arrayBuffer()));
      else console.error('generer-pdf : photo illisible', p.id, fichier.error?.message);
    }
    const manquantes = lignes.photos.length - octets.size;
    // Logo du compte professionnel, s'il en a déposé un.
    let logo: Uint8Array | null = null;
    const org = lignes.organisation;
    if (org?.type === 'pro' && org.logo_path) {
      const fichier = await client.storage.from('marque').download(org.logo_path);
      if (fichier.data) logo = new Uint8Array(await fichier.data.arrayBuffer());
      else console.error('generer-pdf : logo illisible', fichier.error?.message);
    }
    let filigraneImage: Uint8Array | null = null;
    if (org?.filigrane_photos && org.filigrane_image_path) {
      const fichier = await client.storage.from('marque').download(org.filigrane_image_path);
      if (fichier.data) filigraneImage = new Uint8Array(await fichier.data.arrayBuffer());
      else console.error('generer-pdf : image de filigrane illisible', fichier.error?.message);
    }
    const { octets: pdf, cases } = await construireDocument(assembler(lignes, octets, false, logo, filigraneImage));
    const sha256 = await empreintePdf(pdf);
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const chemin = `${lignes.edl.organisation_id}/${edl_id}/pdf/${sha256.slice(0, 16)}.pdf`;

    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const depot = await service.storage.from('edl').upload(chemin, pdf, { contentType: 'application/pdf', upsert: true });
    if (depot.error) throw new Error(`dépôt : ${depot.error.message}`);
    lu(await service.rpc('edl_deposer_pdf', { p_edl: edl_id, p_chemin: chemin, p_sha256: sha256, p_acteur: qui.user.id, p_pages: pages, p_octets: pdf.length, p_cases: cases }));
    return json(200, { statut: 'genere', pdf_path: chemin, pdf_sha256: sha256, pages, photos_manquantes: manquantes });
  } catch (e) {
    if (e instanceof Refus) return json(e.statut, { statut: 'refuse', motif: e.motif, details: e.details });
    console.error('generer-pdf', e);
    return json(500, { statut: 'erreur' });
  }
});
