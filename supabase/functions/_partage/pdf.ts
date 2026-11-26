// Mise en page de l'état des lieux en PDF (A4). Un seul moteur pour deux usages :
//   * l'aperçu, construit sur le téléphone, gratuit, même sans réseau (filigrane) ;
//   * le document définitif, construit par le serveur, dont l'empreinte est conservée.
// Ne dépend que de pdf-lib : tourne dans le navigateur, dans Deno et dans Node.
//
// Contenu : les mentions du décret n° 2016-382 du 30 mars 2016 (art. 2), dans cet
// ordre : type et date, logement, parties et mandataires, compteurs, clés, pièce
// par pièce, puis inventaire du meublé, remarques, signatures, annexe photo.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { LOGO_CONSTATIO } from './logo-constatio.ts';

type Etat = 'neuf' | 'bon' | 'usage' | 'mauvais' | 'hors_service' | 'sans_objet' | null;

export interface DonneesPdf {
  /** Aperçu : filigrane sur chaque page, aucune valeur. */
  apercu: boolean;
  /** Pied de page des documents sans Premium Pro ; null pour une marque blanche. */
  mention: string | null;
  emetteur: { nom: string; adresse: string | null; /** Logo du compte professionnel (PNG ou JPEG), posé en tête du document. */ logo?: Uint8Array | null };
  /** Texte posé en bandeau sur chaque photo du document, suivi de la date et de l'heure de la prise de vue. null : pas de filigrane. */
  filigrane?: string | null;
  /** Photos de l'annexe sur deux ou trois colonnes. */
  photosColonnes?: 2 | 3;
  /** Couleur d'accent choisie par un compte professionnel (#rrggbb). null : couleurs de Constatio. */
  couleur?: string | null;
  /** Image à fond transparent (PNG) posée comme un tampon en bas à droite de chaque photo. */
  filigraneImage?: Uint8Array | null;
  edl: {
    id: string; type: 'entrant' | 'sortant' | 'releve'; date_edl: string; bail_type: string; bail_date_entree: string | null;
    depot_garantie_cents: number | null; realise_par_nom: string; remarques_generales: string | null; date_edl_entree: string | null;
  };
  logement: { adresse: string; complement: string | null; code_postal: string; ville: string; type_bien: string; surface_m2: number | null; meuble: boolean };
  parties: { id: string; role: string; represente_id: string | null; civilite: string | null; prenom: string; nom: string; email: string | null; telephone: string | null; adresse: string | null; nouvelle_adresse: string | null; doit_signer: boolean }[];
  pieces: { id: string; nom: string; observations: string | null }[];
  elements: { id: string; piece_id: string; libelle: string; nature: string | null; etat: Etat; fonctionne?: boolean | null; observations: string | null; detail: string | null; origine_id: string | null }[];
  /** Sortie : l'état et la remarque d'entrée de chaque élément repris, par identifiant d'origine. */
  origines: Record<string, { etat: Etat; observations: string | null }>;
  compteurs: { type: string; absent: boolean; collectif?: boolean; verifie?: boolean; numero: string | null; double_tarif: boolean; index_1: number | null; index_2: number | null; emplacement: string | null }[];
  cles: { nature: string; nombre: number; destination: string }[];
  inventaire: { libelle: string; quantite: number; etat: Etat }[];
  photos: { id: string; element_id: string | null; compteur_type: string | null; legende: string | null; pris_le: string; latitude: number | null; longitude: number | null; octets: Uint8Array | null }[];
}

export const LIBELLES_ETAT: Record<string, string> = { neuf: 'Neuf', bon: 'Bon état', usage: "État d'usage", mauvais: 'Mauvais état', hors_service: 'Hors service', sans_objet: 'Sans objet' };
const TITRES = { entrant: "ÉTAT DES LIEUX D'ENTRÉE", sortant: 'ÉTAT DES LIEUX DE SORTIE', releve: "RELEVÉ D'ÉTAT DU LOGEMENT" } as const;
const ROLES: Record<string, string> = { bailleur: 'Bailleur', locataire: 'Locataire', mandataire_bailleur: 'Mandataire du bailleur', mandataire_locataire: 'Mandataire du locataire' };
const BAUX: Record<string, string> = { vide: 'location vide', meuble: 'location meublée', mobilite: 'bail mobilité', etudiant: 'bail étudiant', colocation: 'colocation', garage: 'garage ou parking', autre: 'autre' };
const BIENS: Record<string, string> = { studio: 'Studio', appartement: 'Appartement', maison: 'Maison', garage: 'Garage ou parking', local: 'Local', autre: 'Logement' };
const COMPTEURS: [string, string, string][] = [['electricite', 'Électricité', 'kWh'], ['eau_froide', 'Eau froide', 'm³'], ['eau_chaude', 'Eau chaude', 'm³'], ['gaz', 'Gaz', 'm³']];
const CLES: Record<string, string> = { cle: 'Clé', badge: 'Badge', bip: 'Bip', telecommande: 'Télécommande', carte: 'Carte', autre: 'Autre' };

const A4 = { l: 595.28, h: 841.89 };
const MARGE = 42;
const LARGEUR = A4.l - 2 * MARGE;
const ENCRE = rgb(0.06, 0.18, 0.18);
const DISCRET = rgb(0.34, 0.42, 0.41);
const TRAIT = rgb(0.81, 0.85, 0.84);
const MARQUE = rgb(0.06, 0.3, 0.29);
const FOND = rgb(0.95, 0.96, 0.96);
const ALERTE = rgb(0.99, 0.94, 0.9);
const REPERE = rgb(0.957, 0.714, 0.102);

/** Les polices standard d'un PDF ne connaissent que l'alphabet occidental (WinAnsi) : on y ramène le texte. */
export function net(texte: string | number | null | undefined): string {
  const remplacements: Record<string, string> = { '’': "'", '‘': "'", '“': '"', '”': '"', ' ': ' ', ' ': ' ', '→': '->', '−': '-', '‑': '-', '\t': ' ' };
  const permis = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ•–—˜™š›œžŸ';
  return [...String(texte ?? '').replace(/\r?\n/g, ' ')].map((c) => remplacements[c] ?? (c.charCodeAt(0) <= 255 || permis.includes(c) ? c : '?')).join('').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}
const dateFr = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }) : '');
const dateHeureFr = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const nombreFr = (n: number) => String(n).replace('.', ',');
const personne = (p: { civilite: string | null; prenom: string; nom: string }) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');
const etat = (e: Etat) => (e ? LIBELLES_ETAT[e] : 'Non renseigné');

function couper(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
  const lignes: string[] = [];
  let ligne = '';
  for (const mot of net(texte).split(' ').filter(Boolean)) {
    let reste = mot;
    // Un mot plus large que la colonne (référence, adresse e-mail) est coupé plutôt que de déborder.
    while (police.widthOfTextAtSize(reste, taille) > largeur) {
      let n = reste.length - 1;
      while (n > 1 && police.widthOfTextAtSize(reste.slice(0, n), taille) > largeur) n--;
      if (ligne) { lignes.push(ligne); ligne = ''; }
      lignes.push(reste.slice(0, n));
      reste = reste.slice(n);
    }
    const essai = ligne ? `${ligne} ${reste}` : reste;
    if (police.widthOfTextAtSize(essai, taille) <= largeur) ligne = essai;
    else { lignes.push(ligne); ligne = reste; }
  }
  if (ligne) lignes.push(ligne);
  return lignes.length ? lignes : [''];
}

interface Colonne { titre: string; largeur: number }

class Feuille {
  page!: PDFPage;
  y = 0;
  constructor(readonly pdf: PDFDocument, readonly normal: PDFFont, readonly gras: PDFFont) { this.nouvellePage(); }
  /** Rappel porté en haut de chaque page après la couverture (« État des lieux d'entrée »). */
  /** Couleur d'accent du document (bandeaux, titres) et couleur des repères de section. */
  accent = MARQUE;
  repere = REPERE;
  entete: string | null = null;
  nouvellePage() {
    this.page = this.pdf.addPage([A4.l, A4.h]);
    this.y = A4.h - MARGE;
    if (!this.entete) return;
    this.page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.l, height: 8, color: this.accent });
    this.page.drawText(this.entete, { x: A4.l - MARGE - this.normal.widthOfTextAtSize(this.entete, 9), y: A4.h - 40, size: 9, font: this.normal, color: DISCRET });
    this.page.drawLine({ start: { x: MARGE, y: A4.h - 52 }, end: { x: A4.l - MARGE, y: A4.h - 52 }, thickness: 0.6, color: TRAIT });
    this.y = A4.h - 62;
  }
  /** Garantit `hauteur` points sous le curseur, quitte à changer de page. */
  place(hauteur: number) { if (this.y - hauteur < MARGE + 26) this.nouvellePage(); }
  espace(h: number) { this.y -= h; }

  texte(texte: string, o: { taille?: number; gras?: boolean; couleur?: ReturnType<typeof rgb>; x?: number; largeur?: number; interligne?: number } = {}) {
    const taille = o.taille ?? 9.5;
    const police = o.gras ? this.gras : this.normal;
    const interligne = o.interligne ?? taille * 1.35;
    for (const ligne of couper(texte, police, taille, o.largeur ?? LARGEUR)) {
      this.place(interligne);
      this.y -= interligne;
      this.page.drawText(ligne, { x: o.x ?? MARGE, y: this.y + interligne * 0.25, size: taille, font: police, color: o.couleur ?? ENCRE });
    }
  }
  titre(texte: string) {
    this.place(52);
    this.espace(16);
    this.page.drawRectangle({ x: MARGE, y: this.y - 17, width: 9, height: 17, color: this.repere });
    this.page.drawText(net(texte).toUpperCase(), { x: MARGE + 17, y: this.y - 13.5, size: 12, font: this.gras, color: ENCRE });
    this.espace(26);
  }
  /** Bandeau de couleur en tête d'une pièce. */
  bandeau(texte: string) {
    this.place(74);
    this.espace(8);
    this.page.drawRectangle({ x: MARGE, y: this.y - 19, width: LARGEUR, height: 19, color: this.accent });
    this.page.drawText(net(texte).slice(0, 90), { x: MARGE + 7, y: this.y - 13.5, size: 10, font: this.gras, color: rgb(1, 1, 1) });
    this.espace(19);
  }
  /** Tableau à largeurs fixes ; une ligne n'est jamais coupée entre deux pages, l'en-tête est répété. */
  tableau(colonnes: Colonne[], lignes: string[][], o: { surligner?: (i: number) => boolean; taille?: number } = {}) {
    const taille = o.taille ?? 8.6;
    const interligne = taille * 1.32;
    const marge = 4;
    const enTete = () => {
      this.place(interligne + 2 * marge + 20);
      const h = interligne + marge;
      this.page.drawRectangle({ x: MARGE, y: this.y - h, width: LARGEUR, height: h, color: FOND });
      let x = MARGE;
      for (const c of colonnes) { this.page.drawText(net(c.titre), { x: x + marge, y: this.y - h + marge + 1, size: taille - 0.6, font: this.gras, color: DISCRET }); x += c.largeur; }
      this.y -= h;
    };
    enTete();
    lignes.forEach((ligne, i) => {
      const cellules = ligne.map((t, j) => couper(t, j === 0 ? this.gras : this.normal, taille, colonnes[j].largeur - 2 * marge));
      const h = Math.max(...cellules.map((c) => c.length)) * interligne + 2 * marge - 2;
      if (this.y - h < MARGE + 26) { this.nouvellePage(); enTete(); }
      if (o.surligner?.(i)) this.page.drawRectangle({ x: MARGE, y: this.y - h, width: LARGEUR, height: h, color: ALERTE });
      let x = MARGE;
      cellules.forEach((c, j) => {
        c.forEach((l, k) => this.page.drawText(l, { x: x + marge, y: this.y - marge - (k + 1) * interligne + interligne * 0.28, size: taille, font: j === 0 ? this.gras : this.normal, color: ENCRE }));
        x += colonnes[j].largeur;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: MARGE, y: this.y }, end: { x: A4.l - MARGE, y: this.y }, thickness: 0.5, color: TRAIT });
    });
    this.espace(6);
  }
}

/** Emplacement réservé à la signature d'une partie : la signature électronique y est apposée ensuite. */
export interface CaseSignature { partie_id: string; page: number; x: number; y: number; largeur: number; hauteur: number }

export async function construirePdf(d: DonneesPdf): Promise<Uint8Array> {
  return (await construireDocument(d)).octets;
}

export async function construireDocument(d: DonneesPdf): Promise<{ octets: Uint8Array; cases: CaseSignature[] }> {
  const pdf = await PDFDocument.create();
  const cases: CaseSignature[] = [];
  const titreDoc = `${TITRES[d.edl.type]} — ${d.logement.adresse}, ${d.logement.code_postal} ${d.logement.ville}`;
  pdf.setTitle(net(titreDoc));
  pdf.setAuthor(net(d.emetteur.nom));
  pdf.setCreator('Constatio');
  pdf.setLanguage('fr-FR');
  const f = new Feuille(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));
  const sortie = d.edl.type === 'sortant';
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(d.couleur ?? '');
  if (hex) {
    // Une couleur choisie remplace les deux teintes de Constatio. Trop claire, elle rendrait les bandeaux illisibles (texte blanc) : on la fonce.
    let [r, v, b] = hex.slice(1).map((x) => parseInt(x, 16) / 255);
    const clarte = 0.299 * r + 0.587 * v + 0.114 * b;
    if (clarte > 0.62) { const k = 0.62 / clarte; r *= k; v *= k; b *= k; }
    f.accent = rgb(r, v, b);
    f.repere = rgb(r, v, b);
  }

  // Les photos sont numérotées dans l'ordre du document : pièce par pièce, puis compteurs, puis le reste.
  const ordre = new Map<string, number>();
  const rang = (p: DonneesPdf['photos'][number]) => {
    const el = d.elements.find((x) => x.id === p.element_id);
    return el ? d.pieces.findIndex((x) => x.id === el.piece_id) * 1000 + d.elements.indexOf(el) : p.compteur_type ? 900_000 : 950_000;
  };
  const photos = [...d.photos].sort((a, b) => rang(a) - rang(b) || a.pris_le.localeCompare(b.pris_le));
  photos.forEach((p, i) => ordre.set(p.id, i + 1));
  const numeros = (filtre: (p: DonneesPdf['photos'][number]) => boolean) => photos.filter(filtre).map((p) => ordre.get(p.id)).join(', ');

  // ── Couverture (page 1) ──────────────────────────────────────────────────────────
  const centre = (texte: string, y: number, taille: number, police: PDFFont, couleur = ENCRE) => {
    const lignes = couper(texte, police, taille, LARGEUR - 40);
    lignes.forEach((l, k) => f.page.drawText(l, { x: (A4.l - police.widthOfTextAtSize(l, taille)) / 2, y: y - k * taille * 1.3, size: taille, font: police, color: couleur }));
    return y - lignes.length * taille * 1.3;
  };
  if (d.emetteur.logo) {
    // PNG ou JPEG, reconnu à ses premiers octets. Un logo illisible ne fait pas échouer le document.
    let logo: PDFImage | null = null;
    try { logo = d.emetteur.logo[0] === 0x89 ? await pdf.embedPng(d.emetteur.logo) : await pdf.embedJpg(d.emetteur.logo); } catch { logo = null; }
    if (logo) {
      const r = Math.min(230 / logo.width, 95 / logo.height, 1);
      f.page.drawImage(logo, { x: (A4.l - logo.width * r) / 2, y: 735 - logo.height * r, width: logo.width * r, height: logo.height * r });
    }
  }
  f.page.drawRectangle({ x: (A4.l - 250) / 2, y: 606, width: 250, height: 3, color: f.repere });
  const [grand, petit] = d.edl.type === 'releve' ? ["RELEVÉ D'ÉTAT", 'DU LOGEMENT'] : ['ÉTAT DES LIEUX', d.edl.type === 'sortant' ? 'DE SORTIE' : "D'ENTRÉE"];
  centre(grand, 556, 29, f.gras);
  centre(petit, 522, 15, f.normal, f.accent);
  f.page.drawLine({ start: { x: 110, y: 492 }, end: { x: A4.l - 110, y: 492 }, thickness: 0.6, color: TRAIT });
  let yc = 446;
  const bloc = (libelle: string, valeur: string) => {
    if (!valeur.trim()) return;
    centre(libelle, yc, 9, f.gras, DISCRET);
    yc = centre(valeur, yc - 22, 12.5, f.normal) - 24;
  };
  const noms = (role: string) => d.parties.filter((p) => p.role === role).map(personne).join(', ');
  bloc('DATE', new Date(d.edl.date_edl).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }));
  bloc(d.parties.filter((p) => p.role === 'locataire').length > 1 ? 'LOCATAIRES' : 'LOCATAIRE', noms('locataire'));
  bloc('ADRESSE DU BIEN', [d.logement.adresse, d.logement.complement, `${d.logement.code_postal} ${d.logement.ville}`].filter(Boolean).join(', '));
  bloc('BAILLEUR', noms('bailleur'));
  bloc('RÉALISÉ PAR', d.edl.realise_par_nom);
  centre(d.emetteur.nom, 96, 9.5, f.gras);
  if (d.emetteur.adresse) centre(d.emetteur.adresse, 83, 8.5, f.normal, DISCRET);

  // ── Informations, compteurs et clés (page 2) ────────────────────────────────────
  f.entete = `${TITRES[d.edl.type].charAt(0)}${TITRES[d.edl.type].slice(1).toLowerCase()}`;
  f.nouvellePage();
  f.titre('Informations');
  f.texte(`Établi le ${dateFr(d.edl.date_edl)}${d.edl.realise_par_nom ? ` par ${d.edl.realise_par_nom}` : ''}`, { taille: 10.5 });
  if (sortie) f.texte(d.edl.date_edl_entree ? `État des lieux d'entrée établi le ${dateFr(d.edl.date_edl_entree)}` : "Date de l'état des lieux d'entrée : non renseignée", { taille: 10.5 });

  f.titre('Logement');
  f.texte([d.logement.adresse, d.logement.complement, `${d.logement.code_postal} ${d.logement.ville}`].filter(Boolean).join(', '), { taille: 10.5, gras: true });
  f.texte([BIENS[d.logement.type_bien] ?? 'Logement', d.logement.surface_m2 ? `${nombreFr(d.logement.surface_m2)} m² habitables` : null, BAUX[d.edl.bail_type],
    d.edl.bail_date_entree ? `entrée dans les lieux le ${dateFr(d.edl.bail_date_entree)}` : null,
    d.edl.depot_garantie_cents !== null ? `dépôt de garantie de ${nombreFr(d.edl.depot_garantie_cents / 100)} €` : null].filter(Boolean).join(' · '));

  f.titre('Parties');
  f.tableau([{ titre: 'Qualité', largeur: 110 }, { titre: 'Identité', largeur: 170 }, { titre: 'Coordonnées', largeur: LARGEUR - 280 }],
    d.parties.map((p) => {
      const represente = d.parties.find((x) => x.id === p.represente_id);
      return [ROLES[p.role] ?? p.role,
        `${personne(p)}${represente ? ` (représente ${personne(represente)})` : ''}${p.doit_signer ? '' : " — absent(e) le jour de l'état des lieux"}`,
        [p.adresse, p.email, p.telephone, sortie && p.role === 'locataire' ? `Nouvelle adresse : ${p.nouvelle_adresse ?? 'non renseignée'}` : null].filter(Boolean).join(' · ')];
    }));

  // ── Compteurs et clés ───────────────────────────────────────────────────────────
  if (d.logement.type_bien !== 'garage' || d.compteurs.length) {
    f.titre('Relevés des compteurs');
    f.tableau([{ titre: 'Énergie', largeur: 90 }, { titre: 'Index relevé', largeur: 175 }, { titre: 'N° de compteur', largeur: 110 }, { titre: 'Emplacement', largeur: LARGEUR - 425 }, { titre: 'Photos', largeur: 50 }],
      // Les quatre énergies figurent toujours ; le chauffage collectif seulement s'il a été relevé.
      [...COMPTEURS, ...(d.compteurs.some((x) => x.type === 'chauffage' && !x.absent) ? [['chauffage', 'Chauffage collectif', ''] as [string, string, string]] : [])].map(([type, libelle, unite]) => {
        const c = d.compteurs.find((x) => x.type === type);
        const valeur = !c ? null : c.double_tarif ? `HP ${c.index_1 !== null ? nombreFr(c.index_1) : '—'} · HC ${c.index_2 !== null ? nombreFr(c.index_2) : '—'} ${unite}` : c.index_1 !== null ? `${nombreFr(c.index_1)} ${unite}`.trim() : null;
        const index = !c ? 'Non relevé' : c.absent ? 'Pas de compteur individuel'
          : c.collectif ? `Compteur collectif${valeur ? ` — ${valeur}` : ''}`
          : `${valeur ?? 'Non relevé'}${c.verifie ? ' — compteur vérifié (eau coulée)' : ''}`;
        return [libelle, index, c?.numero ?? '', c?.emplacement ?? '', numeros((p) => p.compteur_type === type)];
      }));
  }
  f.titre('Clés et moyens d\'accès remis');
  if (d.cles.length) {
    f.tableau([{ titre: 'Nature', largeur: 110 }, { titre: 'Nombre', largeur: 60 }, { titre: 'Destination', largeur: LARGEUR - 170 }],
      d.cles.map((k) => [CLES[k.nature] ?? k.nature, String(k.nombre), k.destination]));
    f.texte(`Total remis : ${d.cles.reduce((s, k) => s + k.nombre, 0)}`, { taille: 9, gras: true });
  } else f.texte('Aucune clé décrite.', { couleur: DISCRET });

  // ── Pièce par pièce ─────────────────────────────────────────────────────────────
  // La description commence en page 3 : la page 2 reste celle des informations, des compteurs et des clés.
  f.nouvellePage();
  f.titre('Description pièce par pièce');
  f.texte(`États : ${Object.values(LIBELLES_ETAT).join(' · ')}.${sortie ? ' Les lignes teintées signalent un état différent de celui constaté à l\'entrée.' : ''}`, { taille: 8.5, couleur: DISCRET });
  f.espace(4);
  for (const piece of d.pieces) {
    const els = d.elements.filter((x) => x.piece_id === piece.id);
    f.bandeau(piece.nom);
    const observation = (el: DonneesPdf['elements'][number]) =>
      [el.fonctionne === false ? 'Ne fonctionne pas.' : el.fonctionne === true ? 'Fonctionne (essayé sur place).' : null, el.observations, el.detail].filter(Boolean).join(' ');
    if (sortie) {
      f.tableau([{ titre: 'Élément', largeur: 120 }, { titre: 'À l\'entrée', largeur: 120 }, { titre: 'À la sortie', largeur: 75 }, { titre: 'Observations à la sortie', largeur: LARGEUR - 365 }, { titre: 'Photos', largeur: 50 }],
        els.map((el) => {
          const o = el.origine_id ? d.origines[el.origine_id] : undefined;
          return [`${el.libelle}${el.nature ? ` (${el.nature})` : ''}`, o ? `${etat(o.etat)}${o.observations ? ` — ${o.observations}` : ''}` : 'Non constaté', etat(el.etat), observation(el), numeros((p) => p.element_id === el.id)];
        }),
        { surligner: (i) => { const o = els[i].origine_id ? d.origines[els[i].origine_id!] : undefined; return !!o?.etat && !!els[i].etat && els[i].etat !== 'sans_objet' && o.etat !== els[i].etat; } });
    } else {
      f.tableau([{ titre: 'Élément', largeur: 125 }, { titre: 'Nature', largeur: 95 }, { titre: 'État', largeur: 75 }, { titre: 'Observations', largeur: LARGEUR - 345 }, { titre: 'Photos', largeur: 50 }],
        els.map((el) => [el.libelle, el.nature ?? '', etat(el.etat), observation(el), numeros((p) => p.element_id === el.id)]));
    }
    if (piece.observations) f.texte(`Observations sur la pièce : ${piece.observations}`, { taille: 9 });
  }

  if (d.inventaire.length) {
    f.titre('Inventaire et état du mobilier');
    f.tableau([{ titre: 'Meuble ou équipement', largeur: LARGEUR - 160 }, { titre: 'Quantité', largeur: 60 }, { titre: 'État', largeur: 100 }],
      d.inventaire.map((i) => [i.libelle, String(i.quantite), etat(i.etat)]));
  }
  if (d.edl.remarques_generales) { f.titre('Remarques générales'); f.texte(d.edl.remarques_generales); }

  // ── Mentions et signatures ───────────────────────────────────────────────────────
  f.titre('Mentions');
  f.texte("État des lieux établi contradictoirement entre les parties, en autant d'exemplaires que de parties, et joint au contrat de location (loi n° 89-462 du 6 juillet 1989, article 3-2 ; décret n° 2016-382 du 30 mars 2016).", { taille: 8.8 });
  if (d.edl.type === 'entrant') {
    f.espace(3);
    f.texte("Le locataire peut demander au bailleur ou à son représentant de compléter le présent état des lieux dans un délai de dix jours à compter de son établissement et, pour l'état des éléments de chauffage, pendant le premier mois de la période de chauffe (loi du 6 juillet 1989, article 3-2).", { taille: 8.8 });
  }
  const signataires = d.parties.filter((p) => p.doit_signer);
  // Le titre, la phrase et la première rangée de cases restent sur la même page.
  f.place(176);
  f.titre('Signatures');
  f.texte(`Fait le ${dateFr(d.edl.date_edl)}. Chaque signataire fait précéder sa signature de la mention « Lu et approuvé ».`, { taille: 9 });
  f.espace(6);
  const largeurCase = (LARGEUR - 12) / 2;
  for (let i = 0; i < signataires.length; i += 2) {
    f.place(92);
    signataires.slice(i, i + 2).forEach((p, j) => {
      const x = MARGE + j * (largeurCase + 12);
      f.page.drawRectangle({ x, y: f.y - 84, width: largeurCase, height: 84, borderColor: TRAIT, borderWidth: 1 });
      f.page.drawText(net(ROLES[p.role] ?? p.role), { x: x + 6, y: f.y - 14, size: 8, font: f.normal, color: DISCRET });
      f.page.drawText(net(personne(p)).slice(0, 48), { x: x + 6, y: f.y - 27, size: 9.5, font: f.gras, color: ENCRE });
      cases.push({ partie_id: p.id, page: pdf.getPageCount() - 1, x: x + 6, y: f.y - 80, largeur: largeurCase - 12, hauteur: 48 });
    });
    f.y -= 92;
  }

  let marqueImage: PDFImage | null = null;
  if (d.filigraneImage) { try { marqueImage = await pdf.embedPng(d.filigraneImage); } catch { marqueImage = null; } }
  // ── Annexe photo : deux ou trois colonnes, chaque rangée à la hauteur de ses photos ──
  // Une photo verticale occupe la même largeur qu'une photo horizontale : elle est simplement plus haute.
  if (photos.length) {
    const colonnes = d.photosColonnes === 3 ? 3 : 2;
    const gouttiere = 12;
    const lc = (LARGEUR - gouttiere * (colonnes - 1)) / colonnes;
    const hMax = lc * 1.34;                       // une photo 3:4 tenue verticalement remplit la largeur
    const petit = colonnes === 3;
    const hLegende = petit ? 36 : 40;
    const images: (PDFImage | null)[] = [];
    for (const p of photos) {
      let image: PDFImage | null = null;
      if (p.octets) { try { image = await pdf.embedJpg(p.octets); } catch { image = null; } }
      images.push(image);
    }
    f.nouvellePage();
    f.texte('Annexe photographique', { taille: 12.5, gras: true, couleur: f.accent });
    f.espace(8);
    for (let debut = 0; debut < photos.length; debut += colonnes) {
      const rang = photos.slice(debut, debut + colonnes).map((p, k) => {
        const image = images[debut + k];
        const r = image ? Math.min(lc / image.width, hMax / image.height) : 0;
        return { p, image, r, h: image ? image.height * r : lc * 0.75 };
      });
      const hRang = Math.max(...rang.map((c) => c.h));
      f.place(hRang + hLegende + 10);
      const haut = f.y;
      rang.forEach(({ p, image, r }, k) => {
        const i = debut + k;
        const x = MARGE + k * (lc + gouttiere);
        f.page.drawRectangle({ x, y: haut - hRang, width: lc, height: hRang, color: FOND });
        if (image) {
          const il = image.width * r, ih = image.height * r;
          const ix = x + (lc - il) / 2, iy = haut - hRang + (hRang - ih) / 2;
          f.page.drawImage(image, { x: ix, y: iy, width: il, height: ih });
          if (marqueImage) {
            // En bas à droite, comme un tampon : il marque la photo sans cacher ce qu'elle montre.
            const m = Math.min((il * 0.26) / marqueImage.width, (ih * 0.3) / marqueImage.height);
            f.page.drawImage(marqueImage, { x: ix + il - marqueImage.width * m - 5, y: iy + (d.filigrane ? 15 : 5), width: marqueImage.width * m, height: marqueImage.height * m, opacity: 0.7 });
          }
          if (d.filigrane) {
            // Bandeau au pied de la photo : il ne masque que quelques millimètres, et suit l'image si elle est copiée hors du document.
            const taille = petit ? 6 : 6.8;
            let marque = net(`${d.filigrane} · ${dateHeureFr(p.pris_le)}`);
            while (marque.length > 8 && f.normal.widthOfTextAtSize(marque, taille) > il - 8) marque = `${marque.slice(0, -2)}…`;
            f.page.drawRectangle({ x: ix, y: iy, width: il, height: 12, color: rgb(0, 0, 0), opacity: 0.5 });
            f.page.drawText(marque, { x: ix + 4, y: iy + 3.4, size: taille, font: f.normal, color: rgb(1, 1, 1), opacity: 0.95 });
          }
        } else f.page.drawText('Photo indisponible', { x: x + 8, y: haut - hRang / 2, size: 9, font: f.normal, color: DISCRET });
        const el = d.elements.find((e) => e.id === p.element_id);
        const piece = el && d.pieces.find((x) => x.id === el.piece_id);
        const ou = el ? `${piece?.nom ?? ''}, ${el.libelle}` : p.compteur_type ? `Compteur ${(COMPTEURS.find((c) => c[0] === p.compteur_type)?.[1] ?? 'de chauffage').toLowerCase()}` : 'Vue générale';
        const t1 = petit ? 7.6 : 8.6, t2 = petit ? 7 : 8, t3 = petit ? 6.5 : 7.5;
        f.page.drawText(couper(`Photo ${i + 1} — ${ou}`, f.gras, t1, lc)[0], { x, y: haut - hRang - 11, size: t1, font: f.gras, color: ENCRE });
        if (p.legende) f.page.drawText(couper(p.legende, f.normal, t2, lc)[0], { x, y: haut - hRang - 21, size: t2, font: f.normal, color: ENCRE });
        f.page.drawText(couper(`Prise le ${dateHeureFr(p.pris_le)}${p.latitude !== null && p.longitude !== null ? ` · ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : ''}`, f.normal, t3, lc)[0], { x, y: haut - hRang - (p.legende ? 31 : 21), size: t3, font: f.normal, color: DISCRET });
      });
      f.y = haut - hRang - hLegende - 8;
    }
  }

  // ── Pied de page et filigrane, sur toutes les pages ──────────────────────────────
  let logoApercu: PDFImage | null = null;
  if (d.apercu) { try { logoApercu = await pdf.embedPng(Uint8Array.from(atob(LOGO_CONSTATIO), (c) => c.charCodeAt(0))); } catch { logoApercu = null; } }
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGE, y: MARGE + 14 }, end: { x: A4.l - MARGE, y: MARGE + 14 }, thickness: 0.5, color: TRAIT });
    page.drawText(net(`${d.logement.adresse}, ${d.logement.ville} · ${dateFr(d.edl.date_edl)}`).slice(0, 80), { x: MARGE, y: MARGE + 2, size: 7.5, font: f.normal, color: DISCRET });
    const numero = `Page ${i + 1} / ${pages.length}`;
    page.drawText(numero, { x: A4.l - MARGE - f.normal.widthOfTextAtSize(numero, 7.5), y: MARGE + 2, size: 7.5, font: f.normal, color: DISCRET });
    if (d.mention) page.drawText(net(d.mention), { x: (A4.l - f.normal.widthOfTextAtSize(net(d.mention), 7.5)) / 2, y: MARGE - 9, size: 7.5, font: f.normal, color: DISCRET });
    if (d.apercu) {
      // Écrit aussi à l'horizontale, en clair : un filigrane en biais ne se lit ni à la recherche ni au lecteur d'écran.
      const bandeau = net('APERÇU SANS VALEUR — document non finalisé');
      page.drawText(bandeau, { x: A4.l - MARGE - f.gras.widthOfTextAtSize(bandeau, 8), y: A4.h - 26, size: 8, font: f.gras, color: rgb(0.75, 0.2, 0.15) });
    }
    if (d.apercu) {
      // Filigrane : le logo de Constatio en travers de la page, et le rappel de ce qui manque pour que le document vaille quelque chose.
      if (logoApercu) {
        const l = 430, h = (logoApercu.height * l) / logoApercu.width, a = (35 * Math.PI) / 180;
        // Le logo tourne autour de son coin bas gauche : on place ce coin pour que son centre tombe au milieu de la page.
        const x = A4.l / 2 - ((l / 2) * Math.cos(a) - (h / 2) * Math.sin(a)), y = A4.h / 2 - ((l / 2) * Math.sin(a) + (h / 2) * Math.cos(a));
        page.drawImage(logoApercu, { x, y, width: l, height: h, rotate: degrees(35), opacity: 0.14 });
      } else page.drawText('CONSTATIO', { x: 118, y: 210, size: 74, font: f.gras, color: rgb(0.75, 0.2, 0.15), opacity: 0.13, rotate: degrees(52) });
      page.drawText(net('APERÇU NON FINALISÉ'), { x: 150, y: 270, size: 24, font: f.gras, color: rgb(0.75, 0.2, 0.15), opacity: 0.16, rotate: degrees(35) });
      const rappel = net("Aperçu : ce document n'a aucune valeur. Un état des lieux ne fait foi qu'une fois finalisé et signé par les parties (loi du 6 juillet 1989, art. 3-2).");
      page.drawText(rappel, { x: (A4.l - f.gras.widthOfTextAtSize(rappel, 6.6)) / 2, y: MARGE + 18, size: 6.6, font: f.gras, color: rgb(0.75, 0.2, 0.15) });
    }
  });
  return { octets: await pdf.save(), cases };
}

/** Empreinte SHA-256 du document : conservée avec lui, elle permet de prouver qu'il n'a pas été modifié. */
export async function empreintePdf(octets: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', octets as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

// ── Des lignes de la base au document ────────────────────────────────────────────
// Les mêmes lignes existent sur le téléphone (copie locale) et sur le serveur : un
// seul assemblage, pour que l'aperçu et le document définitif ne divergent jamais.
// deno-lint-ignore no-explicit-any
type Ligne = Record<string, any>;
export interface LignesEdl {
  edl: Ligne; logement: Ligne; organisation: Ligne | null;
  parties: Ligne[]; pieces: Ligne[]; elements: Ligne[]; compteurs: Ligne[]; cles: Ligne[]; inventaire: Ligne[]; photos: Ligne[];
  /** Sortie : les éléments de l'état des lieux d'entrée de référence, s'il a été fait sur Constatio. */
  elementsEntree: Ligne[];
}
export const MENTION_CONSTATIO = 'Réalisé avec Constatio — partenaire Signabail';

/** Texte du filigrane d'un compte : celui qu'il a choisi, sinon son nom. null s'il n'en veut pas. */
export function filigraneDe(o: Ligne | null): string | null {
  if (!o?.filigrane_photos) return null;
  return String(o.filigrane_texte || o.entete || o.nom || '').trim().slice(0, 60) || null;
}

export function assembler(l: LignesEdl, octets: Map<string, Uint8Array>, apercu: boolean, logo: Uint8Array | null = null, filigraneImage: Uint8Array | null = null): DonneesPdf {
  const range = (lignes: Ligne[]) => [...lignes].sort((a, b) => Number(a.ordre ?? 0) - Number(b.ordre ?? 0) || String(a.created_at ?? a._cree ?? '').localeCompare(String(b.created_at ?? b._cree ?? '')));
  const pieces = range(l.pieces);
  const rangPiece = new Map(pieces.map((p, i) => [p.id, i]));
  const elements = range(l.elements).sort((a, b) => (rangPiece.get(a.piece_id) ?? 0) - (rangPiece.get(b.piece_id) ?? 0));
  const o = l.organisation;
  return {
    apercu, mention: MENTION_CONSTATIO,
    photosColonnes: o?.photos_colonnes === 3 ? 3 : 2,
    couleur: o?.type === 'pro' && /^#[0-9a-f]{6}$/i.test(o.couleur_documents ?? '') ? o.couleur_documents : null,
    filigrane: filigraneDe(o),
    filigraneImage: o?.filigrane_photos ? filigraneImage : null,
    emetteur: { logo: o?.type === 'pro' ? logo : null, nom: o?.entete || o?.nom || '', adresse: o ? [o.adresse, [o.code_postal, o.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null : null },
    edl: { id: l.edl.id, type: l.edl.type, date_edl: l.edl.date_edl, bail_type: l.edl.bail_type, bail_date_entree: l.edl.bail_date_entree ?? null,
      depot_garantie_cents: l.edl.depot_garantie_cents ?? null, realise_par_nom: l.edl.realise_par_nom ?? '', remarques_generales: l.edl.remarques_generales ?? null, date_edl_entree: l.edl.date_edl_entree ?? null },
    logement: { adresse: l.logement.adresse, complement: l.logement.complement ?? null, code_postal: l.logement.code_postal, ville: l.logement.ville, type_bien: l.logement.type_bien, surface_m2: l.logement.surface_m2 ?? null, meuble: !!l.logement.meuble },
    parties: range(l.parties).map((p) => ({ id: p.id, role: p.role, represente_id: p.represente_id ?? null, civilite: p.civilite ?? null, prenom: p.prenom ?? '', nom: p.nom ?? '', email: p.email ?? null, telephone: p.telephone ?? null, adresse: p.adresse ?? null, nouvelle_adresse: p.nouvelle_adresse ?? null, doit_signer: p.doit_signer !== false })),
    pieces: pieces.map((p) => ({ id: p.id, nom: p.nom, observations: p.observations ?? null })),
    elements: elements.map((e) => ({ id: e.id, piece_id: e.piece_id, libelle: e.libelle, nature: e.nature ?? null, etat: e.etat ?? null, fonctionne: e.fonctionne ?? null, observations: e.observations ?? null, detail: e.detail ?? null, origine_id: e.origine_id ?? null })),
    origines: Object.fromEntries(l.elementsEntree.map((e) => [e.id, { etat: e.etat ?? null, observations: e.observations ?? null }])),
    compteurs: l.compteurs.map((c) => ({ type: c.type, absent: !!c.absent, collectif: !!c.collectif, verifie: !!c.verifie, numero: c.numero ?? null, double_tarif: !!c.double_tarif, index_1: c.index_1 ?? null, index_2: c.index_2 ?? null, emplacement: c.emplacement ?? null })),
    cles: range(l.cles).map((k) => ({ nature: k.nature, nombre: Number(k.nombre ?? 0), destination: k.destination ?? '' })),
    inventaire: range(l.inventaire).map((i) => ({ libelle: i.libelle, quantite: Number(i.quantite ?? 1), etat: i.etat ?? null })),
    photos: l.photos.map((p) => ({ id: p.id, element_id: p.element_id ?? null, compteur_type: p.compteur_type ?? null, legende: p.legende ?? null, pris_le: p.pris_le, latitude: p.latitude ?? null, longitude: p.longitude ?? null, octets: octets.get(p.id) ?? null })),
  };
}
