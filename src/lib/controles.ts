// Contrôles en direct : ce qui manque pour que l'état des lieux soit complet au
// sens du décret n° 2016-382 du 30 mars 2016 (art. 2) et, pour un meublé, du
// décret n° 2015-981 du 31 juillet 2015 (art. 2). Fonction pure : elle ne lit
// rien, elle juge ce qu'on lui donne, et chaque alerte dit où aller corriger.
import type { Etat } from './trame';

export type TypeCompteur = 'electricite' | 'gaz' | 'eau_froide' | 'eau_chaude';
export const COMPTEURS: { type: TypeCompteur; libelle: string; unite: string }[] = [
  { type: 'electricite', libelle: 'Électricité', unite: 'kWh' },
  { type: 'eau_froide', libelle: 'Eau froide', unite: 'm³' },
  { type: 'eau_chaude', libelle: 'Eau chaude', unite: 'm³' },
  { type: 'gaz', libelle: 'Gaz', unite: 'm³' },
];

/** Liste minimale du mobilier d'un meublé (décret n° 2015-981, art. 2). Mêmes codes que la table ref_mobilier_decret. */
export const MOBILIER_DECRET: { code: string; libelle: string }[] = [
  { code: 'literie', libelle: 'Literie avec couette ou couverture' },
  { code: 'occultation', libelle: 'Volets ou rideaux occultants dans les chambres' },
  { code: 'plaques', libelle: 'Plaques de cuisson' },
  { code: 'four', libelle: 'Four ou four à micro-ondes' },
  { code: 'refrigerateur', libelle: 'Réfrigérateur avec congélateur ou compartiment à −6 °C' },
  { code: 'vaisselle', libelle: 'Vaisselle pour les repas' },
  { code: 'ustensiles', libelle: 'Ustensiles de cuisine' },
  { code: 'table_sieges', libelle: 'Table et sièges' },
  { code: 'rangements', libelle: 'Étagères de rangement' },
  { code: 'luminaires', libelle: 'Luminaires' },
  { code: 'entretien', libelle: 'Matériel d’entretien ménager' },
];

export interface DonneesControle {
  type: 'entrant' | 'sortant' | 'releve';
  meuble: boolean;
  /** Garage ou parking : ni compteur ni inventaire attendus. */
  sansCompteurs: boolean;
  entreeConnue: boolean;
  parties: { role: string; nom: string; nouvelle_adresse: string | null; represente_id: string | null }[];
  pieces: { id: string; nom: string }[];
  elements: { piece_id: string; libelle: string; etat: Etat | null; observations: string | null }[];
  compteurs: { type: TypeCompteur; absent: boolean; index_1: number | null; index_2: number | null; double_tarif: boolean; numero: string | null }[];
  cles: { nombre: number; destination: string }[];
  inventaire: { code_decret: string | null }[];
}

export interface Alerte {
  /** « bloquant » : mention obligatoire manquante. « conseil » : ce qui renforce la preuve. */
  niveau: 'bloquant' | 'conseil';
  message: string;
  /** Chemin de l'étape à corriger, relatif à l'état des lieux. */
  vers: string;
  action: string;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export function controler(d: DonneesControle): Alerte[] {
  const a: Alerte[] = [];
  const bloquant = (message: string, vers: string, action: string) => a.push({ niveau: 'bloquant', message, vers, action });
  const conseil = (message: string, vers: string, action: string) => a.push({ niveau: 'conseil', message, vers, action });

  // Parties
  const nommes = (role: string) => d.parties.filter((p) => p.role === role && p.nom.trim());
  if (!nommes('bailleur').length) bloquant('Le bailleur n’est pas identifié.', 'parties', 'Compléter les parties');
  if (!nommes('locataire').length) bloquant('Aucun locataire n’est identifié.', 'parties', 'Compléter les parties');
  if (d.parties.some((p) => !p.nom.trim())) bloquant('Une partie n’a pas de nom.', 'parties', 'Compléter les parties');
  if (d.type === 'sortant') {
    if (nommes('locataire').some((p) => !p.nouvelle_adresse?.trim()))
      bloquant('Sortie : la nouvelle adresse du locataire est obligatoire.', 'parties', 'Compléter les parties');
    if (!d.entreeConnue)
      conseil('Sans état des lieux d’entrée précis, une retenue sur le dépôt de garantie est très difficile à justifier.', '', 'Voir l’état des lieux');
  }

  // Pièces
  if (!d.pieces.length) bloquant('Aucune pièce n’est décrite.', '', 'Ajouter une pièce');
  for (const p of d.pieces) {
    const els = d.elements.filter((x) => x.piece_id === p.id);
    const sansEtat = els.filter((x) => x.etat === null).length;
    if (!els.length) bloquant(`${p.nom} : aucun élément décrit.`, `pieces/${p.id}`, 'Ouvrir la pièce');
    else if (sansEtat) bloquant(`${p.nom} : ${pluriel(sansEtat, 'élément sans état', 'éléments sans état')}.`, `pieces/${p.id}`, 'Ouvrir la pièce');
    const muets = els.filter((x) => (x.etat === 'mauvais' || x.etat === 'hors_service') && !x.observations?.trim());
    if (muets.length)
      conseil(`${p.nom} : ${muets.map((x) => x.libelle.toLowerCase()).join(', ')} en mauvais état sans observation. Décrivez le défaut : c’est ce qui fera preuve.`, `pieces/${p.id}`, 'Ouvrir la pièce');
  }

  // Compteurs : chacun est relevé, ou déclaré absent. Jamais laissé vide.
  if (!d.sansCompteurs) {
    for (const c of COMPTEURS) {
      const releve = d.compteurs.find((x) => x.type === c.type);
      if (!releve || (!releve.absent && releve.index_1 === null))
        bloquant(`${c.libelle} : compteur non relevé. Indiquez l’index, ou qu’il n’y a pas de compteur.`, 'compteurs', 'Aller aux compteurs');
      else if (!releve.absent) {
        if (releve.double_tarif && releve.index_2 === null) bloquant(`${c.libelle} : l’index heures creuses manque.`, 'compteurs', 'Aller aux compteurs');
        if (!releve.numero?.trim()) conseil(`${c.libelle} : le numéro du compteur n’est pas noté.`, 'compteurs', 'Aller aux compteurs');
      }
    }
  }

  // Clés
  if (!d.cles.length) bloquant('Aucune clé n’est décrite.', 'cles', 'Aller aux clés');
  else if (d.cles.some((k) => !k.destination.trim() || k.nombre < 1))
    bloquant('Une clé n’a pas de destination ou de nombre.', 'cles', 'Aller aux clés');

  // Meublé : liste minimale du décret
  if (d.meuble && !d.sansCompteurs) {
    const presents = new Set(d.inventaire.map((i) => i.code_decret));
    const manquants = MOBILIER_DECRET.filter((m) => !presents.has(m.code));
    if (manquants.length)
      bloquant(`Meublé : il manque ${manquants.map((m) => m.libelle.toLowerCase()).join(' ; ')} (décret n° 2015-981).`, 'inventaire', 'Compléter l’inventaire');
  }
  return a;
}
