// Photos d'un état des lieux : prises sur place, réduites, datées, localisées,
// gardées sur l'appareil puis déposées au serveur dès qu'il y a du réseau.
//
// Ce qui fait la valeur de preuve :
//   * l'heure de prise (horloge de l'appareil) ET l'heure de réception par le serveur ;
//   * la position, quand l'utilisateur l'autorise ;
//   * l'empreinte SHA-256 du fichier, calculée ici : toute altération se voit ;
//   * le gel à la signature (base et stockage refusent ensuite toute modification).
import { local } from './local';
import { supabase } from './supabase';

export const COTE_MAX = 1600; // pixels : lisible à l'impression A4, environ 300 Ko
export const QUALITE = 0.82;

export interface Photo {
  id: string;
  edl_id: string;
  piece_id: string | null;
  element_id: string | null;
  compteur_type: string | null;
  /** Photo rattachée aux clés remises (le trousseau). */
  objet?: 'cles' | null;
  storage_path: string;
  nom: string;
  mime: string;
  taille: number;
  largeur: number | null;
  hauteur: number | null;
  sha256: string;
  pris_le: string;
  latitude: number | null;
  longitude: number | null;
  precision_m: number | null;
  legende: string | null;
}
export type Cible = { piece_id: string; element_id: string } | { compteur_type: string } | { objet: 'cles' } | Record<string, never>;

/** Dimensions après réduction : le plus grand côté ramené à `max`, proportions gardées, jamais d'agrandissement. */
export function dimensionsCibles(largeur: number, hauteur: number, max = COTE_MAX): { largeur: number; hauteur: number } {
  const plusGrand = Math.max(largeur, hauteur);
  if (plusGrand <= max) return { largeur, hauteur };
  const r = max / plusGrand;
  return { largeur: Math.round(largeur * r), hauteur: Math.round(hauteur * r) };
}

export async function empreinte(contenu: Blob): Promise<string> {
  const octets = await crypto.subtle.digest('SHA-256', await contenu.arrayBuffer());
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

/** Réduit l'image en JPEG. L'orientation de l'appareil est appliquée ; les métadonnées d'origine ne sont pas reprises. */
export async function compresser(fichier: Blob): Promise<{ contenu: Blob; largeur: number; hauteur: number }> {
  const image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  const { largeur, hauteur } = dimensionsCibles(image.width, image.height);
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  toile.getContext('2d')!.drawImage(image, 0, 0, largeur, hauteur);
  image.close();
  const contenu = await new Promise<Blob | null>((ok) => toile.toBlob(ok, 'image/jpeg', QUALITE));
  if (!contenu) throw new Error('compression impossible');
  return { contenu, largeur, hauteur };
}

/** La position, si l'utilisateur l'autorise et qu'elle arrive vite. Jamais bloquant : sans elle, la photo est prise quand même. */
export function position(delaiMs = 4000): Promise<{ latitude: number; longitude: number; precision_m: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((ok) => {
    const fin = setTimeout(() => ok(null), delaiMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(fin); ok({ latitude: p.coords.latitude, longitude: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) }); },
      () => { clearTimeout(fin); ok(null); },
      { enableHighAccuracy: true, timeout: delaiMs, maximumAge: 60_000 },
    );
  });
}

/** Ajoute des photos à un élément, à un compteur, ou à l'état des lieux entier. Rend celles qui ont été ajoutées. */
export async function ajouterPhotos(edl: { id: string; organisation_id: string }, cible: Cible, fichiers: File[], quoi: string): Promise<{ ajoutees: Photo[]; illisibles: number }> {
  const ou = await position();
  const ajoutees: Photo[] = [];
  let illisibles = 0;
  for (const fichier of fichiers) {
    let reduite: Awaited<ReturnType<typeof compresser>>;
    try {
      reduite = await compresser(fichier);
    } catch {
      illisibles++; // pas une image, ou un format que le navigateur ne sait pas lire
      continue;
    }
    const id = crypto.randomUUID();
    const photo: Photo = {
      id, edl_id: edl.id, piece_id: null, element_id: null, compteur_type: null, objet: null, ...cible,
      storage_path: `${edl.organisation_id}/${edl.id}/photos/${id}.jpg`,
      nom: fichier.name || 'photo.jpg', mime: 'image/jpeg', taille: reduite.contenu.size,
      largeur: reduite.largeur, hauteur: reduite.hauteur, sha256: await empreinte(reduite.contenu),
      pris_le: new Date().toISOString(), latitude: ou?.latitude ?? null, longitude: ou?.longitude ?? null, precision_m: ou?.precision_m ?? null,
      legende: null,
    };
    // Le fichier d'abord, la ligne ensuite : la file les enverra dans cet ordre.
    await local.deposerFichier(id, reduite.contenu, photo.storage_path, `Photo, ${quoi}`);
    await local.inserer('edl_photos', { ...photo } as Record<string, unknown> & { id: string }, `Photo, ${quoi}`);
    ajoutees.push(photo);
  }
  return { ajoutees, illisibles };
}

export async function retirerPhoto(photo: Photo, quoi: string): Promise<void> {
  await local.supprimer('edl_photos', photo.id, `Photo, ${quoi}`);
  await local.retirerFichier(photo.id, photo.storage_path, `Photo, ${quoi}`);
}

const adresses = new Map<string, string>();
/** Une adresse affichable : le fichier gardé sur l'appareil, sinon un lien signé de courte durée vers le serveur. */
export async function adressePhoto(photo: Pick<Photo, 'id' | 'storage_path'>): Promise<string | null> {
  const connue = adresses.get(photo.id);
  if (connue) return connue;
  const surAppareil = await local.lireFichier(photo.id);
  if (surAppareil) {
    const adresse = URL.createObjectURL(surAppareil);
    adresses.set(photo.id, adresse);
    return adresse;
  }
  const { data } = await supabase.storage.from('edl').createSignedUrl(photo.storage_path, 3600);
  if (!data?.signedUrl) return null; // hors connexion, photo prise sur un autre appareil
  adresses.set(photo.id, data.signedUrl);
  setTimeout(() => adresses.delete(photo.id), 3_000_000);
  return data.signedUrl;
}

export const heurePhoto = (p: Pick<Photo, 'pris_le'>) =>
  new Date(p.pris_le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const lieuPhoto = (p: Pick<Photo, 'latitude' | 'longitude' | 'precision_m'>) =>
  p.latitude === null || p.longitude === null ? null : `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}${p.precision_m ? ` (± ${p.precision_m} m)` : ''}`;
