// Décompte de restitution du dépôt de garantie, à la sortie (loi du 6 juillet 1989, art. 22).
//   * les dégradations se lisent dans l'écart entre l'entrée et la sortie ;
//   * chaque retenue part d'un devis ou d'une facture, diminué de la vétusté s'il y a lieu ;
//   * le délai de restitution est d'un mois si la sortie est conforme à l'entrée, de deux mois sinon.
// Les calculs sont des fonctions pures, testées. À faire vérifier par un juriste avant de s'en prévaloir.
import type { Element } from './edl';
import type { Etat } from './trame';

export interface LigneGrille { id: string; categorie: string; libelle: string; duree_vie_ans: number; franchise_ans: number; part_residuelle_pct: number; ordre: number }
export interface Retenue { id: string; edl_id: string; element_id: string | null; libelle: string; montant_devis_cents: number; ligne_grille_id: string | null; age_ans: number | null; vetuste_pct: number; montant_retenu_cents: number }

const RANG: Record<string, number> = { neuf: 0, bon: 1, usage: 2, mauvais: 3, hors_service: 4 };

/** Part du coût que l'ancienneté laisse au bailleur, en % : nulle pendant la franchise, puis régulière
 *  jusqu'à la fin de la durée de vie, sans jamais entamer la part résiduelle laissée au locataire. */
export function vetustePct(l: Pick<LigneGrille, 'duree_vie_ans' | 'franchise_ans' | 'part_residuelle_pct'>, ageAns: number): number {
  const plafond = 100 - l.part_residuelle_pct;
  if (!(ageAns > l.franchise_ans)) return 0;
  if (ageAns >= l.duree_vie_ans || l.duree_vie_ans <= l.franchise_ans) return plafond;
  return Math.round(((ageAns - l.franchise_ans) / (l.duree_vie_ans - l.franchise_ans)) * plafond * 100) / 100;
}
/** Ce qui reste à la charge du locataire, vétusté déduite. */
export const montantRetenu = (devisCents: number, pct: number) => Math.max(0, Math.round(devisCents * (1 - Math.min(Math.max(pct, 0), 100) / 100)));

export interface Degradation { element: Element; avant: Etat; apres: Etat; observationsEntree: string | null }
/** Les éléments dont l'état s'est dégradé entre l'entrée et la sortie. */
export function degradations(sortie: Element[], entree: Element[]): Degradation[] {
  const origines = new Map(entree.map((e) => [e.id, e]));
  return sortie.flatMap((el) => {
    const o = el.origine_id ? origines.get(el.origine_id) : undefined;
    if (!o?.etat || !el.etat || RANG[o.etat] === undefined || RANG[el.etat] === undefined) return [];
    return RANG[el.etat] > RANG[o.etat] ? [{ element: el, avant: o.etat, apres: el.etat, observationsEntree: o.observations }] : [];
  });
}

export interface Bilan { depot: number; retenues: number; autres: number; aRestituer: number; resteDu: number; conforme: boolean; dateLimite: string }
/** Le solde du dépôt et la date limite de restitution. `remiseCles` au format AAAA-MM-JJ. */
export function bilan(depotCents: number, retenues: Pick<Retenue, 'montant_retenu_cents'>[], autresCents: number, remiseCles: string, ecarts: number): Bilan {
  const total = retenues.reduce((s, r) => s + r.montant_retenu_cents, 0);
  const solde = depotCents - total - autresCents;
  // Conforme : aucune dégradation relevée et aucune retenue pour réparation.
  const conforme = ecarts === 0 && total === 0;
  return { depot: depotCents, retenues: total, autres: autresCents, aRestituer: Math.max(solde, 0), resteDu: Math.max(-solde, 0), conforme, dateLimite: ajouterMois(remiseCles, conforme ? 1 : 2) };
}
/** Même quantième le mois suivant ; à défaut (31 janvier + 1 mois), le dernier jour du mois. */
export function ajouterMois(jour: string, mois: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}

export const euros = (centimes: number) => `${(centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
/** « 123,45 » ou « 123.45 » → centimes ; null si ce n'est pas un montant. */
export function centimes(saisie: string): number | null {
  const v = saisie.replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
const jourFr = (j: string) => new Date(`${j}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Le décompte en PDF : à adresser au locataire, avec les devis ou factures qui justifient chaque retenue. */
export async function decomptePdf(d: {
  adresse: string; bailleur: string; locataires: string; dateSortie: string; remiseCles: string; bilan: Bilan; autresMotif: string | null;
  retenues: { libelle: string; devis: number; vetuste: number; retenu: number; grille: string | null; age: number | null }[];
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const { net } = await import('../../supabase/functions/_partage/pdf');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica), gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const encre = rgb(0.06, 0.18, 0.18), discret = rgb(0.34, 0.42, 0.41), marque = rgb(0.06, 0.3, 0.29);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const place = (h: number) => { if (y < 60 + h) { page = pdf.addPage([595.28, 841.89]); y = 790; } };
  const ecrire = (texte: string, o: { taille?: number; g?: boolean; couleur?: ReturnType<typeof rgb>; apres?: number; x?: number; largeur?: number } = {}) => {
    const taille = o.taille ?? 10, police = o.g ? gras : normal, x = o.x ?? 42, largeur = o.largeur ?? 511;
    let ligne = '';
    const lignes: string[] = [];
    for (const mot of net(texte).split(' ')) { const essai = ligne ? `${ligne} ${mot}` : mot; if (police.widthOfTextAtSize(essai, taille) <= largeur) ligne = essai; else { lignes.push(ligne); ligne = mot; } }
    lignes.push(ligne);
    for (const l of lignes) { place(taille); page.drawText(l, { x, y, size: taille, font: police, color: o.couleur ?? encre }); y -= taille * 1.45; }
    y -= o.apres ?? 0;
  };
  /** Une ligne à deux colonnes : libellé à gauche, montant aligné à droite. */
  const ligne = (libelle: string, montant: string, o: { g?: boolean; taille?: number } = {}) => {
    const taille = o.taille ?? 10, police = o.g ? gras : normal;
    place(taille + 8);
    const haut = y;
    ecrire(libelle, { taille, g: o.g, largeur: 380 });
    page.drawText(net(montant), { x: 553 - police.widthOfTextAtSize(net(montant), taille), y: haut, size: taille, font: police, color: encre });
    page.drawLine({ start: { x: 42, y: y + 4 }, end: { x: 553, y: y + 4 }, thickness: 0.5, color: rgb(0.81, 0.85, 0.84) });
    y -= 6;
  };
  const b = d.bilan;
  ecrire('Décompte de restitution du dépôt de garantie', { taille: 17, g: true, couleur: marque, apres: 6 });
  ecrire(d.adresse, { taille: 11, g: true });
  ecrire(`Bailleur : ${d.bailleur || '—'}`);
  ecrire(`Locataire${d.locataires.includes(',') ? 's' : ''} : ${d.locataires || '—'}`);
  ecrire(`État des lieux de sortie du ${jourFr(d.dateSortie)} · clés remises le ${jourFr(d.remiseCles)}`, { couleur: discret, apres: 12 });

  ligne('Dépôt de garantie versé', euros(b.depot), { g: true });
  if (d.retenues.length) { y -= 4; ecrire('Retenues pour réparations', { g: true, apres: 2 }); }
  for (const r of d.retenues) {
    ligne(r.libelle, `- ${euros(r.retenu)}`);
    y += 4;
    ecrire(r.vetuste > 0 ? `Devis ou facture : ${euros(r.devis)} · vétusté déduite : ${String(r.vetuste).replace('.', ',')} %${r.grille ? ` (${r.grille}${r.age !== null ? `, ${String(r.age).replace('.', ',')} an${r.age >= 2 ? 's' : ''}` : ''})` : ''}` : `Devis ou facture : ${euros(r.devis)} · sans déduction de vétusté`, { taille: 8, couleur: discret, apres: 4 });
  }
  if (b.autres) ligne(`Autres sommes restant dues${d.autresMotif ? ` : ${d.autresMotif}` : ''}`, `- ${euros(b.autres)}`);
  y -= 4;
  ligne(b.resteDu ? 'Dépôt de garantie restitué' : 'Somme restituée au locataire', euros(b.aRestituer), { g: true, taille: 12 });
  if (b.resteDu) ligne('Reste dû par le locataire, au-delà du dépôt', euros(b.resteDu), { g: true, taille: 12 });
  y -= 8;
  ecrire(`Date limite de restitution : ${jourFr(b.dateLimite)}, soit ${b.conforme ? 'un mois' : 'deux mois'} après la remise des clés, l’état des lieux de sortie ${b.conforme ? 'étant conforme' : 'n’étant pas conforme'} à celui d’entrée (loi du 6 juillet 1989, article 22).`, { apres: 6 });
  ecrire('Chaque retenue doit être justifiée : joignez à ce décompte les devis ou factures correspondants. À défaut de restitution dans le délai, le dépôt restant dû est majoré de 10 % du loyer mensuel en principal pour chaque période mensuelle commencée en retard, sauf si le locataire n’a pas transmis sa nouvelle adresse (même article).', { taille: 9, couleur: discret, apres: 6 });
  if (d.retenues.some((r) => r.vetuste > 0)) ecrire('La vétusté est l’usure résultant du temps ou de l’usage normal (décret n° 2016-382 du 30 mars 2016, article 4). Elle est ici calculée selon une grille indicative ; une grille ne s’impose aux parties que si elles en sont convenues au bail.', { taille: 9, couleur: discret, apres: 6 });
  ecrire(`Décompte établi le ${jourFr(new Date().toISOString().slice(0, 10))} avec Constatio.`, { taille: 8, couleur: discret });
  return pdf.save();
}
