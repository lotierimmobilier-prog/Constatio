import { local } from './local';
import { MODELES_LOGEMENT, pieceType, typeDepuisNom, type Etat } from './trame';

export type TypeEdl = 'entrant' | 'sortant' | 'releve';
export type StatutEdl = 'brouillon' | 'termine' | 'signe';
export type RolePartie = 'bailleur' | 'locataire' | 'mandataire_bailleur' | 'mandataire_locataire';

export const TYPES_EDL: Record<TypeEdl, string> = { entrant: 'Entrée', sortant: 'Sortie', releve: 'Relevé d’état' };
export const STATUTS_EDL: Record<StatutEdl, { libelle: string; couleur: string }> = {
  brouillon: { libelle: 'Brouillon', couleur: 'text-usage' },
  termine: { libelle: 'Terminé', couleur: 'text-mauvais' },
  signe: { libelle: 'Signé', couleur: 'text-neuf' },
};

export interface Logement {
  id: string;
  libelle: string;
  type_bien: string;
  adresse: string;
  complement: string | null;
  code_postal: string;
  ville: string;
  surface_m2: number | null;
  meuble: boolean;
}
export interface Piece {
  id: string;
  edl_id: string;
  zone: 'interieur' | 'exterieur';
  nom: string;
  type_piece: string | null;
  observations: string | null;
  ordre: number;
  origine_id: string | null;
}
export interface Element {
  id: string;
  edl_id: string;
  piece_id: string;
  categorie: string;
  libelle: string;
  nature: string | null;
  etat: Etat | null;
  observations: string | null;
  detail: string | null;
  /** Équipement essayé sur place : fonctionne, ne fonctionne pas, ou non testé (null). */
  fonctionne?: boolean | null;
  ordre: number;
  origine_id: string | null;
}
export interface Partie {
  id: string;
  edl_id: string;
  role: RolePartie;
  represente_id: string | null;
  civilite: string | null;
  prenom: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  nouvelle_adresse: string | null;
  doit_signer: boolean;
  ordre: number;
}

const uuid = () => crypto.randomUUID();

/** Les lignes « pièces » et « éléments » d'une trame, prêtes à insérer. */
export function lignesDepuisModele(edlId: string, modeleId: string) {
  const modele = MODELES_LOGEMENT.find((m) => m.id === modeleId) ?? MODELES_LOGEMENT[0];
  const pieces: Omit<Piece, 'observations' | 'origine_id'>[] = [];
  const elements: Pick<Element, 'id' | 'edl_id' | 'piece_id' | 'categorie' | 'libelle' | 'ordre'>[] = [];
  modele.pieces.forEach((p, i) => {
    const type = pieceType(p.type);
    const pieceId = uuid();
    pieces.push({ id: pieceId, edl_id: edlId, zone: type.zone, nom: p.label ?? type.label, type_piece: type.id, ordre: i });
    type.elements.forEach((el, j) =>
      elements.push({ id: uuid(), edl_id: edlId, piece_id: pieceId, categorie: el.id, libelle: el.label, ordre: j }),
    );
  });
  return { pieces, elements };
}

/** Les éléments par défaut d'une pièce ajoutée à la main. */
export function elementsDePiece(edlId: string, pieceId: string, typePiece: string) {
  return pieceType(typePiece).elements.map((el, j) => ({
    id: uuid(), edl_id: edlId, piece_id: pieceId, categorie: el.id, libelle: el.label, ordre: j,
  }));
}

export interface DemandeCreation {
  organisationId: string;
  type: TypeEdl;
  realisePar: { id: string; nom: string };
  /** Logement existant, ou nouveau logement à créer avec son modèle de pièces. */
  logementId?: string;
  nouveauLogement?: Omit<Logement, 'id'> & { modeleId: string; nb_pieces: number | null; a_exterieur: boolean };
  /** Modèle de pièces pour un logement déjà enregistré. */
  modeleId?: string;
  /** EDL d'entrée dont on repart (sortie ou relevé). */
  entreeId?: string;
  bailleur: { nom: string; adresse: string | null };
}

export interface EdlLigne {
  id: string;
  organisation_id: string;
  logement_id: string;
  type: TypeEdl;
  statut: StatutEdl;
  date_edl: string;
  entree_id: string | null;
  date_edl_entree: string | null;
  bail_type: string;
  bail_date_entree: string | null;
  depot_garantie_cents: number | null;
  credit_consomme: boolean;
  remarques_generales: string | null;
  source?: string;
  signabail_bail_id?: string | null;
  updated_at?: string;
  _cree?: string;
}

/** Met à jour la copie locale si le réseau le permet, puis la lit. null : inconnu de l'appareil. */
export async function chargerEdl(id: string): Promise<{ edl: EdlLigne; logement: Logement } | null> {
  await local.tirerEdl(id);
  const edl = await local.lire<EdlLigne>('edl', id);
  const logement = edl && (await local.lire<Logement>('logements', edl.logement_id));
  return edl && logement ? { edl, logement } : null;
}

/**
 * Un brouillon créé par le serveur à la signature d'un bail Signabail arrive avec
 * ses pièces mais sans leurs éléments : la trame vit dans l'application. On la
 * pose ici, une seule fois, à la première ouverture.
 */
export async function completerBrouillonRecu(edl: EdlLigne): Promise<boolean> {
  if (edl.source !== 'signabail' || edl.statut !== 'brouillon') return false;
  if ((await local.lister('edl_elements', 'edl_id', edl.id)).length) return false;
  let pieces = await local.lister<Piece>('edl_pieces', 'edl_id', edl.id);
  if (!pieces.length) {
    // Signabail ne connaît que le nombre de pièces : on part du modèle correspondant.
    const logement = await local.lire<Logement & { nb_pieces?: number | null }>('logements', edl.logement_id);
    const modele = logement?.type_bien === 'maison' ? 'maison' : logement?.type_bien === 'studio' ? 'studio' : `t${Math.min(Math.max(logement?.nb_pieces ?? 2, 1), 6)}`;
    const lignes = lignesDepuisModele(edl.id, modele);
    await local.inserer('edl_pieces', lignes.pieces.map((p) => ({ ...p, observations: null, origine_id: null })), 'Pièces');
    await local.inserer('edl_elements', lignes.elements.map((el) => ({ ...el, nature: null, etat: null, observations: null, detail: null, origine_id: null })), 'Éléments');
    return true;
  }
  pieces = pieces.filter(Boolean);
  for (const p of pieces) {
    const type = pieceType(p.type_piece ?? typeDepuisNom(p.nom));
    await local.modifier('edl_pieces', p.id, { type_piece: type.id, zone: type.zone }, p.nom);
    await local.inserer('edl_elements', elementsDePiece(edl.id, p.id, type.id).map((el) => ({ ...el, nature: null, etat: null, observations: null, detail: null, origine_id: null })), p.nom);
  }
  // Détecteur de fumée, tableau électrique, chaudière… : hors pièces, donc absents d'un bail.
  if (!pieces.some((p) => (p.type_piece ?? typeDepuisNom(p.nom)) === 'equipements')) {
    const id = uuid();
    const type = pieceType('equipements');
    await local.inserer('edl_pieces', { id, edl_id: edl.id, zone: type.zone, nom: type.label, type_piece: type.id, observations: null, origine_id: null, ordre: pieces.length }, type.label);
    await local.inserer('edl_elements', elementsDePiece(edl.id, id, type.id).map((el) => ({ ...el, nature: null, etat: null, observations: null, detail: null, origine_id: null })), type.label);
  }
  return true;
}

/**
 * Crée l'EDL et tout son contenu de départ dans la copie locale ; l'envoi au
 * serveur suit dès qu'il y a du réseau. Fonctionne donc dans une cave.
 */
export async function creerEdl(d: DemandeCreation): Promise<string> {
  const edlId = uuid();
  let logementId = d.logementId;
  let modeleId = d.modeleId ?? 't2';

  if (d.nouveauLogement) {
    const { modeleId: m, ...logement } = d.nouveauLogement;
    modeleId = m;
    logementId = uuid();
    await local.inserer('logements', { id: logementId, organisation_id: d.organisationId, ...logement }, 'Logement');
  }
  if (!logementId) throw new Error('Logement manquant');

  let entree: EdlLigne | undefined;
  if (d.entreeId) {
    await local.tirerEdl(d.entreeId);
    entree = await local.lire<EdlLigne>('edl', d.entreeId);
    if (!entree) throw new Error('entree_indisponible');
  }
  const logement = await local.lire<Logement>('logements', logementId);

  await local.inserer(
    'edl',
    {
      id: edlId,
      organisation_id: d.organisationId,
      logement_id: logementId,
      type: d.type,
      entree_id: d.entreeId ?? null,
      date_edl_entree: entree ? entree.date_edl.slice(0, 10) : null,
      bail_type: entree?.bail_type ?? (logement?.meuble ? 'meuble' : 'vide'),
      bail_date_entree: entree?.bail_date_entree ?? null,
      depot_garantie_cents: entree?.depot_garantie_cents ?? null,
      realise_par: d.realisePar.id,
      realise_par_nom: d.realisePar.nom,
      date_edl: new Date().toISOString(),
    },
    'Nouvel état des lieux',
    // Remplis par le serveur ; présents localement pour l'affichage immédiat.
    { statut: 'brouillon', credit_consomme: false, remarques_generales: null },
  );

  if (d.entreeId) {
    await copierDepuisEntree(edlId, d.entreeId);
  } else {
    const { pieces, elements } = lignesDepuisModele(edlId, modeleId);
    await local.inserer('edl_pieces', pieces, 'Pièces');
    await local.inserer('edl_elements', elements, 'Éléments');
    await local.inserer('edl_parties', { id: uuid(), edl_id: edlId, role: 'bailleur', prenom: '', nom: d.bailleur.nom, adresse: d.bailleur.adresse, doit_signer: true, ordre: 0 }, 'Bailleur');
  }
  return edlId;
}

/** Sortie ou relevé : mêmes pièces, mêmes éléments, mêmes parties ; les états restent à constater. */
async function copierDepuisEntree(edlId: string, entreeId: string) {
  const [pieces, elements, parties] = await Promise.all([
    local.lister<Piece>('edl_pieces', 'edl_id', entreeId),
    local.lister<Element>('edl_elements', 'edl_id', entreeId),
    local.lister<Partie>('edl_parties', 'edl_id', entreeId),
  ]);
  const nouvellePiece = new Map<string, string>();
  const lignesPieces = pieces.map((p) => {
    const id = uuid();
    nouvellePiece.set(p.id, id);
    return { id, edl_id: edlId, zone: p.zone, nom: p.nom, type_piece: p.type_piece, ordre: p.ordre, origine_id: p.id };
  });
  const lignesElements = elements.map((el) => ({
    id: uuid(), edl_id: edlId, piece_id: nouvellePiece.get(el.piece_id)!, categorie: el.categorie,
    libelle: el.libelle, nature: el.nature, ordre: el.ordre, origine_id: el.id,
  }));
  const nouvellePartie = new Map<string, string>();
  parties.forEach((p) => nouvellePartie.set(p.id, uuid()));
  const lignesParties = [...parties]
    // Les représentés avant leurs mandataires : la clé étrangère l'exige.
    .sort((a, b) => Number(!!a.represente_id) - Number(!!b.represente_id))
    .map((p) => ({
      id: nouvellePartie.get(p.id)!, edl_id: edlId, role: p.role,
      represente_id: p.represente_id ? nouvellePartie.get(p.represente_id)! : null,
      civilite: p.civilite, prenom: p.prenom, nom: p.nom, email: p.email, telephone: p.telephone,
      adresse: p.adresse, doit_signer: p.doit_signer, ordre: p.ordre,
    }));
  if (lignesPieces.length) await local.inserer('edl_pieces', lignesPieces, 'Pièces');
  if (lignesElements.length) await local.inserer('edl_elements', lignesElements, 'Éléments');
  if (lignesParties.length) await local.inserer('edl_parties', lignesParties, 'Parties');
}

export interface Avancement {
  total: number;
  faits: number;
  aSignaler: number;
}
export function avancement(elements: Pick<Element, 'etat'>[]): Avancement {
  return {
    total: elements.length,
    faits: elements.filter((x) => x.etat !== null).length,
    aSignaler: elements.filter((x) => x.etat === 'mauvais' || x.etat === 'hors_service').length,
  };
}

// ── Contrôles ───────────────────────────────────────────────────────────────
import { controler, type Alerte, type DonneesControle } from './controles';

/** Lit dans la copie locale tout ce que les contrôles examinent, et rend le verdict. */
export async function controlerEdl(edlId: string): Promise<{ alertes: Alerte[]; donnees: DonneesControle } | null> {
  const edl = await local.lire<EdlLigne>('edl', edlId);
  const logement = edl && (await local.lire<Logement>('logements', edl.logement_id));
  if (!edl || !logement) return null;
  const lister = <T,>(t: Parameters<typeof local.lister>[0]) => local.lister<T>(t, 'edl_id', edlId);
  const donnees: DonneesControle = {
    type: edl.type,
    meuble: estMeuble(logement.meuble, edl.bail_type),
    sansCompteurs: logement.type_bien === 'garage',
    entreeConnue: !!edl.entree_id || !!edl.date_edl_entree,
    parties: await lister('edl_parties'),
    pieces: await lister('edl_pieces'),
    elements: await lister('edl_elements'),
    compteurs: await lister('edl_compteurs'),
    cles: await lister('edl_cles'),
    inventaire: await lister('edl_inventaire'),
    photos: await lister('edl_photos'),
  };
  return { alertes: controler(donnees), donnees };
}

export const estMeuble = (logementMeuble: boolean, bailType: string) =>
  logementMeuble || ['meuble', 'mobilite', 'etudiant'].includes(bailType);

/** « 18 432,5 » ou « 18432.5 » → nombre ; vide → null ; illisible → NaN. */
export function lireIndex(saisie: string): number | null {
  const v = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  if (!v) return null;
  return /^\d+(\.\d{1,3})?$/.test(v) ? Number(v) : NaN;
}
