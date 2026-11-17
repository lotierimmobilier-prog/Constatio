import { supabase } from './supabase';
import { MODELES_LOGEMENT, pieceType, type Etat } from './trame';

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
  /** EDL d'entrée dont on repart (sortie ou relevé). */
  entreeId?: string;
  bailleur: { nom: string; adresse: string | null };
}

const echec = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

/**
 * Crée l'EDL et tout son contenu de départ. Les identifiants sont générés ici :
 * la même fonction servira hors connexion, les lignes étant envoyées plus tard.
 * En cas d'échec en cours de route, l'EDL entamé est supprimé (ses lignes suivent).
 */
export async function creerEdl(d: DemandeCreation): Promise<string> {
  const edlId = uuid();
  let logementId = d.logementId;
  let modeleId = 't2';

  if (d.nouveauLogement) {
    const { modeleId: m, ...logement } = d.nouveauLogement;
    modeleId = m;
    logementId = uuid();
    echec((await supabase.from('logements').insert({ id: logementId, organisation_id: d.organisationId, ...logement })).error);
  }
  if (!logementId) throw new Error('Logement manquant');

  let entree: { date_edl: string; bail_type: string; bail_date_entree: string | null; depot_garantie_cents: number | null } | null = null;
  if (d.entreeId) {
    const r = await supabase.from('edl').select('date_edl, bail_type, bail_date_entree, depot_garantie_cents').eq('id', d.entreeId).single();
    echec(r.error);
    entree = r.data;
  }

  echec(
    (
      await supabase.from('edl').insert({
        id: edlId,
        organisation_id: d.organisationId,
        logement_id: logementId,
        type: d.type,
        entree_id: d.entreeId ?? null,
        date_edl_entree: entree ? entree.date_edl.slice(0, 10) : null,
        bail_type: entree?.bail_type ?? (d.nouveauLogement?.meuble ? 'meuble' : 'vide'),
        bail_date_entree: entree?.bail_date_entree ?? null,
        depot_garantie_cents: entree?.depot_garantie_cents ?? null,
        realise_par: d.realisePar.id,
        realise_par_nom: d.realisePar.nom,
      })
    ).error,
  );

  try {
    if (d.entreeId) {
      await copierDepuisEntree(edlId, d.entreeId);
    } else {
      const { pieces, elements } = lignesDepuisModele(edlId, modeleId);
      echec((await supabase.from('edl_pieces').insert(pieces)).error);
      echec((await supabase.from('edl_elements').insert(elements)).error);
      echec(
        (
          await supabase.from('edl_parties').insert({ id: uuid(), edl_id: edlId, role: 'bailleur', nom: d.bailleur.nom, adresse: d.bailleur.adresse, ordre: 0 })
        ).error,
      );
    }
  } catch (err) {
    await supabase.from('edl').delete().eq('id', edlId);
    throw err;
  }
  return edlId;
}

/** Sortie ou relevé : mêmes pièces, mêmes éléments, mêmes parties ; les états restent à constater. */
async function copierDepuisEntree(edlId: string, entreeId: string) {
  const [pieces, elements, parties] = await Promise.all([
    supabase.from('edl_pieces').select('*').eq('edl_id', entreeId),
    supabase.from('edl_elements').select('*').eq('edl_id', entreeId),
    supabase.from('edl_parties').select('*').eq('edl_id', entreeId),
  ]);
  echec(pieces.error ?? elements.error ?? parties.error);

  const nouvellePiece = new Map<string, string>();
  const lignesPieces = (pieces.data as Piece[]).map((p) => {
    const id = uuid();
    nouvellePiece.set(p.id, id);
    return { id, edl_id: edlId, zone: p.zone, nom: p.nom, type_piece: p.type_piece, ordre: p.ordre, origine_id: p.id };
  });
  const lignesElements = (elements.data as Element[]).map((el) => ({
    id: uuid(), edl_id: edlId, piece_id: nouvellePiece.get(el.piece_id)!, categorie: el.categorie,
    libelle: el.libelle, nature: el.nature, ordre: el.ordre, origine_id: el.id,
  }));
  const nouvellePartie = new Map<string, string>();
  (parties.data as Partie[]).forEach((p) => nouvellePartie.set(p.id, uuid()));
  const lignesParties = (parties.data as Partie[])
    // Les représentés avant leurs mandataires : la clé étrangère l'exige.
    .sort((a, b) => Number(!!a.represente_id) - Number(!!b.represente_id))
    .map((p) => ({
      id: nouvellePartie.get(p.id)!, edl_id: edlId, role: p.role,
      represente_id: p.represente_id ? nouvellePartie.get(p.represente_id)! : null,
      civilite: p.civilite, prenom: p.prenom, nom: p.nom, email: p.email, telephone: p.telephone,
      adresse: p.adresse, doit_signer: p.doit_signer, ordre: p.ordre,
    }));

  if (lignesPieces.length) echec((await supabase.from('edl_pieces').insert(lignesPieces)).error);
  if (lignesElements.length) echec((await supabase.from('edl_elements').insert(lignesElements)).error);
  if (lignesParties.length) echec((await supabase.from('edl_parties').insert(lignesParties)).error);
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

/** Lit tout ce que les contrôles examinent, et rend le verdict. */
export async function controlerEdl(edlId: string): Promise<{ alertes: Alerte[]; donnees: DonneesControle } | null> {
  const [e, parties, pieces, elements, compteurs, cles, inventaire] = await Promise.all([
    supabase.from('edl').select('type, bail_type, entree_id, date_edl_entree, logements(meuble, type_bien)').eq('id', edlId).maybeSingle(),
    supabase.from('edl_parties').select('role, nom, nouvelle_adresse, represente_id').eq('edl_id', edlId),
    supabase.from('edl_pieces').select('id, nom').eq('edl_id', edlId).order('ordre').order('created_at'),
    supabase.from('edl_elements').select('piece_id, libelle, etat, observations').eq('edl_id', edlId).order('ordre'),
    supabase.from('edl_compteurs').select('type, absent, index_1, index_2, double_tarif, numero').eq('edl_id', edlId),
    supabase.from('edl_cles').select('nombre, destination').eq('edl_id', edlId),
    supabase.from('edl_inventaire').select('code_decret').eq('edl_id', edlId),
  ]);
  if (!e.data) return null;
  const logement = e.data.logements as unknown as { meuble: boolean; type_bien: string };
  const donnees: DonneesControle = {
    type: e.data.type,
    meuble: estMeuble(logement.meuble, e.data.bail_type),
    sansCompteurs: logement.type_bien === 'garage',
    entreeConnue: !!e.data.entree_id || !!e.data.date_edl_entree,
    parties: parties.data ?? [],
    pieces: pieces.data ?? [],
    elements: elements.data ?? [],
    compteurs: compteurs.data ?? [],
    cles: cles.data ?? [],
    inventaire: inventaire.data ?? [],
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
