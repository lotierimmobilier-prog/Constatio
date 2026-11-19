// Phrases types proposées sous le champ « Observations » : un appui les ajoute.
// Formulations factuelles et datables d'un constat (ce que l'on voit, où, de
// quelle taille), jamais un jugement sur le locataire.
const PAR_FAMILLE: Record<string, string[]> = {
  sol: ['Rayures superficielles', 'Tache devant la fenêtre', 'Lame décollée', 'Carreau fêlé', 'Carreau ébréché', 'Joints noircis', 'Trace de brûlure', 'Usure au passage'],
  murs: ['Traces de frottement', 'Trous de cheville rebouchés', 'Trous de cheville non rebouchés', 'Éclat de peinture', 'Tache d’humidité', 'Papier peint décollé', 'Fissure fine', 'Peinture récente'],
  plafond: ['Peinture récente', 'Tache d’humidité', 'Fissure fine', 'Peinture écaillée', 'Traces de moisissure'],
  menuiserie: ['Ferme correctement', 'Frotte à la fermeture', 'Poignée desserrée', 'Vitrage fêlé', 'Joint usé', 'Serrure dure', 'Clé absente', 'Sangle de volet effilochée', 'Volet bloqué'],
  electricite: ['Fonctionne, testé sur place', 'Cache fêlé', 'Prise descellée', 'Ampoule absente', 'Ne fonctionne pas'],
  plomberie: ['Fonctionne, sans fuite', 'Goutte à goutte', 'Joint silicone noirci', 'Traces de calcaire', 'Évacuation lente', 'Émail éclaté', 'Mécanisme de chasse à régler'],
  chauffage: ['Fonctionne, testé sur place', 'Non testé (hors période de chauffe)', 'Robinet thermostatique bloqué', 'Traces de rouille', 'Entretien annuel à justifier'],
  mobilier: ['Portes et tiroirs fonctionnent', 'Charnière desserrée', 'Chant décollé', 'Étagère manquante', 'Rayures sur le plan'],
  exterieur: ['Entretenu', 'Tondu récemment', 'Taillé récemment', 'À tailler', 'Mauvaises herbes', 'Dalle descellée', 'Mousse sur le dallage', 'Fonctionne, testé sur place'],
  defaut: ['Propre', 'Traces d’usage', 'Fonctionne, testé sur place', 'Non testé', 'À nettoyer'],
};

const FAMILLE: [RegExp, string][] = [
  [/^(sol|plinthes)$/, 'sol'],
  [/^(murs|credence|facade)$/, 'murs'],
  [/^plafond$/, 'plafond'],
  [/^(porte|porte_paliere|fenetres|volets|boiseries|tringles|volets_ext|menuiseries|portail|cloture|garde_corps|acces)$/, 'menuiserie'],
  [/^(electricite|luminaires|interphone|tableau|daaf|detecteur_gaz|fibre|digicode|eclairage)$/, 'electricite'],
  [/^(evier|robinet_|siphon|lavabo|baignoire|douche|paroi|joints|cuvette|abattant|chasse|lave_mains|raccordements|robinet|evacuation|arrosage|filtration)/, 'plomberie'],
  [/^(chauffage|seche_serviettes|chauffe_eau|clim|vmc)$/, 'chauffage'],
  [/^(placard|meubles_|meuble_vasque|plan_travail|miroir|plaques|hotte|bal)/, 'mobilier'],
  [/^(pelouse|arbres|plantations|massifs|potager|invasives|terrasse|allees|abri|eau_compost|proprete|toiture|gouttieres|bassin|eau|volet|entretien|plage|securite)$/, 'exterieur'],
];

export function phrasesTypes(categorie: string): string[] {
  return PAR_FAMILLE[FAMILLE.find(([motif]) => motif.test(categorie))?.[1] ?? 'defaut'];
}

/** Ajoute une phrase à une observation, sans doublon et avec la ponctuation. */
export function ajouterPhrase(observation: string | null, phrase: string): string {
  const actuelle = (observation ?? '').trim();
  if (!actuelle) return `${phrase}.`;
  if (actuelle.toLowerCase().includes(phrase.toLowerCase())) return actuelle;
  return `${actuelle.replace(/[.;,]$/, '')}. ${phrase}.`;
}
