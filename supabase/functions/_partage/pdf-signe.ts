// L'exemplaire signé : le document définitif, auquel on ajoute les signatures dans
// leurs cases et, en dernière page, le dossier de preuve. Le document d'origine
// n'est pas reconstruit : ses pages sont reprises telles quelles, et son empreinte
// (celle que chaque partie a signée) est rappelée dans le dossier de preuve.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { net, type CaseSignature } from './pdf.ts';

export interface SignaturePosee {
  partie_id: string; qualite: string; nom: string;
  mode: 'sur_place' | 'a_distance'; signe_le: string;
  ip: string | null; appareil: string | null;
  /** Tracé manuscrit, en PNG. */
  image: Uint8Array | null;
}
export interface DossierPreuve {
  empreinte: string;                 // SHA-256 du document définitif, tel que signé
  genere_le: string | null;
  signatures: SignaturePosee[];
  /** Mode test ou compte de recette : la signature n'engage personne, et le document le dit. */
  essai: boolean;
}

const instant = (iso: string) => `${new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' })} (heure de Paris)`;
const MODES = { sur_place: "Sur place, sur l'appareil de la personne qui réalise l'état des lieux", a_distance: 'À distance, par lien personnel à usage unique' };

export async function signerPdf(original: Uint8Array, cases: CaseSignature[], d: DossierPreuve): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const encre = rgb(0.06, 0.18, 0.18), discret = rgb(0.34, 0.42, 0.41), marque = rgb(0.06, 0.3, 0.29), rouge = rgb(0.75, 0.2, 0.15);
  const pagesOrigine = pdf.getPageCount();
  const images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
  for (const s of d.signatures) {
    if (s.image) { try { images.set(s.partie_id, await pdf.embedPng(s.image)); } catch { /* tracé illisible : la preuve écrite demeure */ } }
  }

  // 1. Chaque signature dans sa case.
  for (const c of cases) {
    const s = d.signatures.find((x) => x.partie_id === c.partie_id);
    if (!s || c.page >= pagesOrigine) continue;
    const page = pdf.getPage(c.page);
    const image = images.get(c.partie_id);
    if (image) {
      const r = Math.min((c.largeur - 4) / image.width, (c.hauteur - 9) / image.height);
      page.drawImage(image, { x: c.x + (c.largeur - image.width * r) / 2, y: c.y + 9, width: image.width * r, height: image.height * r });
    }
    page.drawText(net(`Lu et approuvé — signé électroniquement le ${instant(s.signe_le)}`), { x: c.x, y: c.y, size: 6.3, font: normal, color: discret });
  }

  // 2. Le dossier de preuve, en dernière page.
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const ligne = (texte: string, o: { taille?: number; g?: boolean; couleur?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const taille = o.taille ?? 9;
    if (y < 70) { page = pdf.addPage([595.28, 841.89]); y = 800; }
    page.drawText(net(texte), { x: o.x ?? 42, y, size: taille, font: o.g ? gras : normal, color: o.couleur ?? encre });
    y -= taille * 1.5;
  };
  ligne('Dossier de preuve des signatures', { taille: 15, g: true, couleur: marque });
  y -= 6;
  if (d.essai) { ligne('MODE TEST — signatures de démonstration, sans valeur.', { g: true, couleur: rouge }); y -= 4; }
  ligne("Les signatures ci-dessous portent sur le document dont voici l'empreinte numérique (SHA-256).");
  ligne("Toute modification du document, même d'un seul caractère, donnerait une empreinte différente.");
  y -= 3;
  ligne(d.empreinte, { taille: 8.5, g: true });
  if (d.genere_le) ligne(`Document généré le ${instant(d.genere_le)}.`, { couleur: discret, taille: 8.5 });
  y -= 10;
  for (const s of d.signatures) {
    if (y < 170) { page = pdf.addPage([595.28, 841.89]); y = 800; }
    page.drawLine({ start: { x: 42, y: y + 8 }, end: { x: 553, y: y + 8 }, thickness: 0.5, color: rgb(0.81, 0.85, 0.84) });
    y -= 6;
    const haut = y;
    ligne(`${s.qualite} — ${s.nom}`, { taille: 10.5, g: true });
    ligne(`Signé le ${instant(s.signe_le)}`);
    ligne(MODES[s.mode]);
    ligne(`Adresse IP : ${s.ip ?? 'non relevée'}`, { couleur: discret, taille: 8.5 });
    ligne(`Appareil : ${(s.appareil ?? 'non relevé').slice(0, 95)}`, { couleur: discret, taille: 8.5 });
    const image = images.get(s.partie_id);
    if (image) {
      const r = Math.min(150 / image.width, 56 / image.height);
      page.drawImage(image, { x: 553 - image.width * r, y: haut - 44, width: image.width * r, height: image.height * r });
    }
    y -= 14;
  }
  ligne("Signature électronique simple au sens du règlement (UE) n° 910/2014 (eIDAS), article 3, point 10 ; recevable comme preuve", { couleur: discret, taille: 8 });
  ligne("(article 25 du même règlement ; article 1366 du code civil). Le journal horodaté de l'état des lieux est conservé par Constatio.", { couleur: discret, taille: 8 });
  pdf.setSubject(net(`Exemplaire signé — empreinte du document d'origine : ${d.empreinte}`));
  return pdf.save();
}
