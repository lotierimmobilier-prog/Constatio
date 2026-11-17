// Trame des pièces et de leurs éléments. Les identifiants (pièces et éléments)
// sont ceux du module EDL de Collab (src/lib/edl2.ts) : c'est ce qui rend les
// états des lieux échangeables entre les deux outils sans table de conversion.
// Le jardin reprend en plus les rubriques du cahier des charges Constatio.

export interface ElementTrame {
  id: string;
  label: string;
  /** Précision attendue en plus de l'état (« Tondue le… ») : c'est l'intitulé du champ. */
  detail?: string;
}
export interface PieceTrame {
  id: string;
  label: string;
  zone: 'interieur' | 'exterieur';
  elements: ElementTrame[];
}

const e = (id: string, label: string, detail?: string): ElementTrame => ({ id, label, detail });

const COMMUN: ElementTrame[] = [
  e('sol', 'Sol'), e('murs', 'Murs'), e('plafond', 'Plafond'), e('plinthes', 'Plinthes'),
  e('boiseries', 'Boiseries et huisseries'), e('porte', 'Porte'), e('fenetres', 'Fenêtres'),
  e('volets', 'Volets / stores'), e('electricite', 'Prises, interrupteurs'),
  e('luminaires', 'Luminaires et appliques'), e('chauffage', 'Chauffage'),
];
const SIPHON = e('siphon', 'Siphon et évacuation');
const JOINTS = e('joints', 'Joints et silicone');
const VMC = e('vmc', 'VMC / aération');

export const PIECES_TYPES: PieceTrame[] = [
  { id: 'entree', label: 'Entrée', zone: 'interieur', elements: [...COMMUN,
    e('porte_paliere', 'Porte palière et serrure', 'Nombre de points, cylindre'),
    e('interphone', 'Interphone / sonnette'), e('placard', 'Placard / penderie')] },
  { id: 'sejour', label: 'Séjour', zone: 'interieur', elements: [...COMMUN, e('tringles', 'Tringles et rideaux')] },
  { id: 'cuisine', label: 'Cuisine', zone: 'interieur', elements: [...COMMUN,
    e('plan_travail', 'Plan de travail'), e('meubles_hauts', 'Meubles hauts'), e('meubles_bas', 'Meubles bas et tiroirs'),
    e('credence', 'Crédence'), e('evier', 'Évier'), e('robinet_evier', 'Robinetterie de l’évier'),
    e('siphon_evier', 'Siphon et évacuation de l’évier'), e('plaques', 'Plaques de cuisson'), e('hotte', 'Hotte'),
    e('raccordements', 'Arrivées et évacuations (lave-linge, lave-vaisselle)')] },
  { id: 'chambre', label: 'Chambre', zone: 'interieur', elements: [...COMMUN, e('placard', 'Placard / penderie'), e('tringles', 'Tringles et rideaux')] },
  { id: 'sdb', label: 'Salle de bain', zone: 'interieur', elements: [...COMMUN,
    e('baignoire', 'Baignoire'), e('douche', 'Douche et receveur'), e('paroi', 'Paroi / rideau de douche'),
    e('robinet_douche', 'Robinetterie douche / baignoire'), e('lavabo', 'Lavabo / vasque'),
    e('robinet_lavabo', 'Robinetterie du lavabo'), e('meuble_vasque', 'Meuble vasque'), e('miroir', 'Miroir'),
    SIPHON, JOINTS, e('seche_serviettes', 'Sèche-serviettes'), VMC] },
  { id: 'salle_eau', label: 'Salle d’eau', zone: 'interieur', elements: [...COMMUN,
    e('douche', 'Douche et receveur'), e('paroi', 'Paroi / rideau de douche'), e('robinet_douche', 'Robinetterie de la douche'),
    e('lavabo', 'Lavabo / vasque'), e('robinet_lavabo', 'Robinetterie du lavabo'), e('meuble_vasque', 'Meuble vasque'),
    e('miroir', 'Miroir'), SIPHON, JOINTS, VMC] },
  { id: 'wc', label: 'WC', zone: 'interieur', elements: [
    e('sol', 'Sol'), e('murs', 'Murs'), e('plafond', 'Plafond'), e('porte', 'Porte'), e('electricite', 'Prises, interrupteurs'),
    e('cuvette', 'Cuvette'), e('abattant', 'Abattant'), e('chasse', 'Chasse d’eau et mécanisme'),
    e('siphon_wc', 'Siphon et évacuation'), e('lave_mains', 'Lave-mains'), e('robinet_lave_mains', 'Robinetterie du lave-mains'), VMC] },
  { id: 'couloir', label: 'Couloir / dégagement', zone: 'interieur', elements: [...COMMUN, e('placard', 'Placards')] },
  { id: 'bureau', label: 'Bureau', zone: 'interieur', elements: [...COMMUN, e('tringles', 'Tringles et rideaux')] },
  { id: 'buanderie', label: 'Buanderie / cellier', zone: 'interieur', elements: [...COMMUN,
    e('raccordements', 'Arrivées et évacuations (lave-linge, sèche-linge)'), SIPHON, e('placard', 'Placards et étagères')] },
  { id: 'cave', label: 'Cave', zone: 'interieur', elements: [e('sol', 'Sol'), e('murs', 'Murs'), e('porte', 'Porte et serrure'), e('electricite', 'Éclairage')] },
  { id: 'garage', label: 'Garage', zone: 'interieur', elements: [e('sol', 'Sol'), e('porte', 'Porte / accès'), e('electricite', 'Éclairage')] },
  { id: 'parking', label: 'Place de parking', zone: 'exterieur', elements: [e('sol', 'Sol et marquage'), e('acces', 'Accès (barrière, portail, bip)')] },
  { id: 'balcon', label: 'Balcon / terrasse', zone: 'exterieur', elements: [e('sol', 'Sol'), e('garde_corps', 'Garde-corps'), e('evacuation', 'Évacuation des eaux')] },
  { id: 'jardin', label: 'Jardin et extérieurs', zone: 'exterieur', elements: [
    e('pelouse', 'Pelouse', 'Tondue le…'), e('arbres', 'Arbres', 'Nombre, essences'),
    e('plantations', 'Haies et arbustes', 'Taillés le…'), e('massifs', 'Massifs'), e('potager', 'Potager'),
    e('invasives', 'Palmiers, bambous et plantes invasives'),
    e('arrosage', 'Arrosage automatique', 'Programmateur, nombre de zones'),
    e('cloture', 'Clôtures et murs'), e('portail', 'Portail et portillon', 'Motorisation, nombre de télécommandes'),
    e('terrasse', 'Terrasses et dallages'), e('allees', 'Allées et accès'),
    e('abri', 'Abris et dépendances', 'Clé, contenu'), e('eclairage', 'Éclairage extérieur'),
    e('eau_compost', 'Récupération d’eau et compost'), e('robinet', 'Robinet extérieur'),
    e('evacuation', 'Évacuations, regards, gouttières'), e('proprete', 'Propreté générale')] },
  { id: 'facade', label: 'Façade et toiture', zone: 'exterieur', elements: [
    e('facade', 'Façade, enduit, peinture'), e('toiture', 'Toiture vue du sol'), e('gouttieres', 'Gouttières et descentes'),
    e('volets_ext', 'Volets et stores extérieurs'), e('menuiseries', 'Menuiseries extérieures'), e('eclairage', 'Éclairage de façade')] },
  { id: 'piscine', label: 'Piscine et spa', zone: 'exterieur', elements: [
    e('securite', 'Dispositif de sécurité (obligatoire)', 'Barrière, alarme, volet ou abri : lequel ?'),
    e('bassin', 'Bassin, liner, margelles'), e('eau', 'Eau : niveau et clarté'), e('filtration', 'Filtration, pompe, local technique'),
    e('volet', 'Volet / bâche'), e('entretien', 'Matériel d’entretien (robot, épuisette)'), e('plage', 'Plage et abords')] },
  { id: 'equipements', label: 'Équipements et sécurité', zone: 'interieur', elements: [
    e('daaf', 'Détecteur de fumée', 'Nombre, emplacement, testé le…'), e('detecteur_gaz', 'Détecteur de gaz / CO', 'Emplacement, testé le…'),
    e('vmc', 'VMC / aération', 'Propreté des bouches'), e('fibre', 'Fibre optique (prise PTO)', 'N° de prise, emplacement'),
    e('tableau', 'Tableau électrique et disjoncteur', 'Emplacement, étiquetage'),
    e('chauffe_eau', 'Chaudière / chauffe-eau', 'Type, marque, dernier entretien le…'),
    e('clim', 'Climatisation / pompe à chaleur', 'Dernier entretien le…'),
    e('interphone', 'Interphone / visiophone'), e('digicode', 'Digicode / accès immeuble'), e('bal', 'Boîte aux lettres', 'N° / étiquette')] },
  { id: 'autre', label: 'Autre pièce', zone: 'interieur', elements: COMMUN },
];

export const pieceType = (id: string | null | undefined): PieceTrame =>
  PIECES_TYPES.find((p) => p.id === id) ?? PIECES_TYPES.find((p) => p.id === 'autre')!;

/** Devine le type de trame d'une pièce d'après son nom (pièces reçues d'un bail Signabail, saisies librement). */
export function typeDepuisNom(nom: string): string {
  const n = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const regles: [RegExp, string][] = [
    [/salle d.?eau|douche/, 'salle_eau'], [/salle de bain|sdb/, 'sdb'], [/\bwc\b|toilette/, 'wc'],
    [/cuisine|kitchenette/, 'cuisine'], [/chambre/, 'chambre'], [/sejour|salon|piece principale|piece de vie|salle a manger/, 'sejour'],
    [/entree|hall|vestibule/, 'entree'], [/couloir|degagement|palier/, 'couloir'], [/bureau/, 'bureau'],
    [/buanderie|cellier|arriere-cuisine/, 'buanderie'], [/cave/, 'cave'], [/garage|box/, 'garage'], [/parking|stationnement/, 'parking'],
    [/balcon|terrasse|loggia/, 'balcon'], [/jardin|cour\b|exterieur/, 'jardin'], [/piscine|spa/, 'piscine'], [/facade|toiture/, 'facade'],
  ];
  return regles.find(([motif]) => motif.test(n))?.[1] ?? 'autre';
}

/** Intitulé de la précision attendue pour un élément de la trame, s'il y en a une. */
export const detailAttendu = (typePiece: string | null, categorie: string): string | undefined =>
  pieceType(typePiece).elements.find((x) => x.id === categorie)?.detail;

export interface ModeleLogement {
  id: string;
  label: string;
  typeBien: 'studio' | 'appartement' | 'maison' | 'garage' | 'local';
  nbPieces: number | null;
  pieces: { type: string; label?: string }[];
}
const chambres = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'chambre', label: n > 1 ? `Chambre ${i + 1}` : 'Chambre' }));
const appartement = (n: number, extra: { type: string }[] = []): ModeleLogement => ({
  id: `t${n}`, label: `T${n}`, typeBien: 'appartement', nbPieces: n,
  pieces: [{ type: 'entree' }, { type: 'sejour' }, { type: 'cuisine' }, ...chambres(n - 1), { type: 'sdb' }, ...extra, { type: 'wc' }, { type: 'equipements' }],
});

export const MODELES_LOGEMENT: ModeleLogement[] = [
  { id: 'studio', label: 'Studio', typeBien: 'studio', nbPieces: 1, pieces: [
    { type: 'entree' }, { type: 'sejour', label: 'Pièce principale' }, { type: 'cuisine', label: 'Coin cuisine' },
    { type: 'salle_eau' }, { type: 'wc' }, { type: 'equipements' }] },
  { id: 't1', label: 'T1', typeBien: 'appartement', nbPieces: 1, pieces: [
    { type: 'entree' }, { type: 'sejour', label: 'Pièce principale' }, { type: 'cuisine' }, { type: 'salle_eau' }, { type: 'wc' }, { type: 'equipements' }] },
  appartement(2), appartement(3), appartement(4, [{ type: 'couloir' }]),
  appartement(5, [{ type: 'salle_eau' }, { type: 'couloir' }]), appartement(6, [{ type: 'salle_eau' }, { type: 'couloir' }]),
  { id: 'maison', label: 'Maison', typeBien: 'maison', nbPieces: null, pieces: [
    { type: 'entree' }, { type: 'sejour' }, { type: 'cuisine' }, ...chambres(3), { type: 'sdb' }, { type: 'wc' },
    { type: 'couloir' }, { type: 'buanderie' }, { type: 'garage' }, { type: 'jardin' }, { type: 'facade' }, { type: 'equipements' }] },
  { id: 'garage', label: 'Garage / parking', typeBien: 'garage', nbPieces: null, pieces: [{ type: 'garage' }] },
  { id: 'local', label: 'Local', typeBien: 'local', nbPieces: null, pieces: [
    { type: 'entree' }, { type: 'bureau', label: 'Local' }, { type: 'buanderie', label: 'Réserve' }, { type: 'wc' }, { type: 'equipements' }] },
];

export type Etat = 'neuf' | 'bon' | 'usage' | 'mauvais' | 'hors_service' | 'sans_objet';
/** L'échelle rapide de la visite : une lettre en plus de la couleur. */
export const ETATS: { id: Etat; court: string; label: string; classe: string }[] = [
  { id: 'neuf', court: 'N', label: 'Neuf', classe: 'bg-neuf' },
  { id: 'bon', court: 'B', label: 'Bon état', classe: 'bg-bon' },
  { id: 'usage', court: 'U', label: 'État d’usage', classe: 'bg-usage' },
  { id: 'mauvais', court: 'M', label: 'Mauvais état', classe: 'bg-mauvais' },
  { id: 'hors_service', court: 'HS', label: 'Hors service', classe: 'bg-hs' },
];
export const libelleEtat = (etat: Etat | null): string =>
  etat === 'sans_objet' ? 'Sans objet' : (ETATS.find((x) => x.id === etat)?.label ?? 'Non renseigné');
