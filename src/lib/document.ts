// Le document de l'état des lieux, vu de l'application : l'aperçu (construit ici,
// gratuit, même sans réseau) et le document définitif (construit par le serveur).
import type { LignesEdl } from '../../supabase/functions/_partage/pdf';
import { local } from './local';
import { supabase } from './supabase';

type Ligne = Record<string, unknown> & { id: string };

/** L'émetteur n'est pas dans la copie locale : on le retient à chaque lecture réussie pour les jours sans réseau. */
async function organisation(id: string): Promise<Ligne | null> {
  const cle = `constatio.organisation.${id}`;
  try {
    const lire = (colonnes: string) => supabase.from('organisations').select(colonnes as '*').eq('id', id).maybeSingle() as unknown as Promise<{ data: Ligne | null }>;
    let { data } = await lire('id, type, nom, entete, adresse, code_postal, ville, logo_path, filigrane_photos, filigrane_texte, filigrane_image_path, photos_colonnes, couleur_documents');
    if (!data) ({ data } = await lire('id, type, nom, entete, adresse, code_postal, ville, logo_path, filigrane_photos, filigrane_texte, filigrane_image_path'));
    // Base sans l'image de filigrane : on se contente du reste.
    if (!data) ({ data } = await lire('id, type, nom, entete, adresse, code_postal, ville, logo_path, filigrane_photos, filigrane_texte'));
    // Base pas encore à jour : on se passe des réglages de présentation.
    if (!data) ({ data } = await lire('id, type, nom, entete, adresse, code_postal, ville'));
    if (data) { try { localStorage.setItem(cle, JSON.stringify(data)); } catch { /* stockage refusé : sans gravité */ } return data as Ligne; }
  } catch { /* hors connexion */ }
  try { return JSON.parse(localStorage.getItem(cle) ?? 'null'); } catch { return null; }
}

/** Une image de marque du compte (logo, filigrane), gardée sur l'appareil (il est petit) pour que l'aperçu le porte aussi sans réseau. */
async function imageDeMarque(chemin: unknown): Promise<Uint8Array | null> {
  if (typeof chemin !== 'string' || !chemin) return null;
  const cle = `constatio.logo.${chemin}`;
  try {
    const { data } = await supabase.storage.from('marque').download(chemin);
    if (data) {
      const octets = new Uint8Array(await data.arrayBuffer());
      try { let texte = ''; for (let i = 0; i < octets.length; i += 8192) texte += String.fromCharCode(...octets.subarray(i, i + 8192)); localStorage.setItem(cle, btoa(texte)); } catch { /* stockage refusé */ }
      return octets;
    }
  } catch { /* hors connexion */ }
  try { const garde = localStorage.getItem(cle); return garde ? Uint8Array.from(atob(garde), (c) => c.charCodeAt(0)) : null; } catch { return null; }
}

export interface Apercu { pdf: Uint8Array; photos: number; photosAbsentes: number }

/** Construit l'aperçu à partir de ce que l'appareil détient. null : état des lieux inconnu de l'appareil. */
export async function construireApercu(edlId: string): Promise<Apercu | null> {
  const edl = await local.lire<Ligne & { logement_id: string; organisation_id: string; entree_id: string | null }>('edl', edlId);
  const logement = edl && (await local.lire<Ligne>('logements', edl.logement_id));
  if (!edl || !logement) return null;
  const fille = <T = Ligne>(table: Parameters<typeof local.lister>[0], de = edlId) => local.lister<T>(table, 'edl_id', de);
  const photos = await fille<Ligne & { storage_path: string }>('edl_photos');
  const octets = new Map<string, Uint8Array>();
  for (const p of photos) {
    let fichier: Blob | undefined = await local.lireFichier(p.id);
    if (!fichier) {
      // Photo prise sur un autre appareil : on va la chercher si le réseau le permet.
      try { fichier = (await supabase.storage.from('edl').download(p.storage_path)).data ?? undefined; } catch { fichier = undefined; }
    }
    if (fichier) octets.set(p.id, new Uint8Array(await fichier.arrayBuffer()));
  }
  const org = await organisation(edl.organisation_id);
  const lignes: LignesEdl = {
    edl, logement, organisation: org,
    parties: await fille('edl_parties'), pieces: await fille('edl_pieces'), elements: await fille('edl_elements'), compteurs: await fille('edl_compteurs'),
    cles: await fille('edl_cles'), inventaire: await fille('edl_inventaire'), photos,
    elementsEntree: edl.entree_id ? await fille('edl_elements', edl.entree_id) : [],
  };
  // Le moteur de mise en page (350 ko) n'est chargé qu'ici ; il est gardé sur l'appareil pour le hors connexion.
  const { assembler, construirePdf } = await import('../../supabase/functions/_partage/pdf');
  return { pdf: await construirePdf(assembler(lignes, octets, true, org?.type === 'pro' ? await imageDeMarque(org.logo_path) : null, org?.filigrane_photos ? await imageDeMarque(org.filigrane_image_path) : null)), photos: photos.length, photosAbsentes: photos.length - octets.size };
}

export type Generation =
  | { statut: 'genere' | 'deja'; pdf_path: string; pdf_sha256: string; photos_manquantes?: number }
  | { statut: 'refuse'; motif: 'credit' | 'incomplet' | 'signe' | 'session' | 'introuvable' | 'interdit' | string }
  | { statut: 'reseau' };

/** Demande au serveur le document définitif. Tout ce qui attend sur l'appareil est envoyé d'abord. */
export async function genererDocument(edlId: string): Promise<Generation> {
  await local.synchroniser();
  if (local.lireEtat().enAttente > 0) return { statut: 'reseau' };
  const { data, error } = await supabase.functions.invoke('generer-pdf', { body: { edl_id: edlId } });
  let reponse = data as Generation | null;
  if (error) {
    // Un refus du serveur arrive comme une erreur : sa réponse dit pourquoi.
    const contexte = (error as { context?: Response }).context;
    try { reponse = contexte ? await contexte.json() : null; } catch { reponse = null; }
    if (!reponse || !('statut' in reponse) || (reponse.statut as string) === 'erreur') return contexte ? { statut: 'refuse', motif: 'erreur' } : { statut: 'reseau' };
  }
  await local.tirerEdl(edlId, true);
  return reponse ?? { statut: 'reseau' };
}

export async function rouvrir(edlId: string): Promise<string | null> {
  const { error } = await supabase.rpc('edl_rouvrir', { p_edl: edlId });
  if (error) return error.message;
  await local.tirerEdl(edlId, true);
  return null;
}

/** Lien de téléchargement du document définitif, valable une heure. */
export async function adresseDocument(chemin: string): Promise<string | null> {
  const { data } = await supabase.storage.from('edl').createSignedUrl(chemin, 3600);
  return data?.signedUrl ?? null;
}
