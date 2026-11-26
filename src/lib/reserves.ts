// Réserves du locataire après un état des lieux d'entrée signé (dix jours). Tout passe par
// des fonctions de la base : le lien du locataire fonctionne sans compte.
import { supabase } from './supabase';

export interface Reserve { id: string; partie_id: string | null; texte: string; statut: 'demande' | 'accepte' | 'refuse'; reponse: string | null; created_at: string; repondu_le: string | null }
export const STATUTS_RESERVE = { demande: 'En attente de réponse', accepte: 'Acceptée', refuse: 'Refusée' } as const;
export const instant = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function reservesDe(edlId: string): Promise<Reserve[] | null> {
  const { data, error } = await supabase.from('edl_complements').select('id, partie_id, texte, statut, reponse, created_at, repondu_le').eq('edl_id', edlId).eq('type', 'general').order('created_at');
  return error ? null : (data as Reserve[]);
}

/** Crée le lien de réserves d'un locataire. Le jeton reste ici ; la base n'en garde que l'empreinte. */
export async function creerLienReserves(edlId: string, partieId: string): Promise<{ lien: string; limite: string } | { erreur: string }> {
  const jeton = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const empreinte = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton)))].map((o) => o.toString(16).padStart(2, '0')).join('');
  const { data, error } = await supabase.rpc('reserves_lien', { p_edl: edlId, p_partie: partieId, p_jeton_hash: empreinte });
  if (error) return { erreur: ['P0001', '42501'].includes(error.code) ? error.message : 'Le lien n’a pas pu être créé. Vérifiez votre connexion puis réessayez.' };
  return { lien: `${window.location.origin}/reserves/${jeton}`, limite: data as string };
}

/** L'annexe des réserves, en PDF : à joindre à l'état des lieux, qui lui ne change pas. */
export async function annexeReserves(d: { titre: string; adresse: string; signeLe: string | null; empreinte: string | null; reserves: (Reserve & { de: string })[] }): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const { net } = await import('../../supabase/functions/_partage/pdf');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica), gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const encre = rgb(0.06, 0.18, 0.18), discret = rgb(0.34, 0.42, 0.41);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const ecrire = (texte: string, o: { taille?: number; g?: boolean; couleur?: ReturnType<typeof rgb>; apres?: number } = {}) => {
    const taille = o.taille ?? 10, police = o.g ? gras : normal;
    let ligne = '';
    const lignes: string[] = [];
    for (const mot of net(texte).split(' ')) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) <= 511) ligne = essai; else { lignes.push(ligne); ligne = mot; }
    }
    lignes.push(ligne);
    for (const l of lignes) {
      if (y < 60) { page = pdf.addPage([595.28, 841.89]); y = 790; }
      page.drawText(l, { x: 42, y, size: taille, font: police, color: o.couleur ?? encre });
      y -= taille * 1.45;
    }
    y -= o.apres ?? 0;
  };
  ecrire('Annexe — réserves du locataire', { taille: 17, g: true, apres: 4 });
  ecrire(`${d.titre} — ${d.adresse}`, { taille: 11, g: true });
  if (d.signeLe) ecrire(`État des lieux signé le ${instant(d.signeLe)}.`, { couleur: discret });
  if (d.empreinte) ecrire(`Empreinte du document signé (SHA-256) : ${d.empreinte}`, { taille: 8, couleur: discret });
  ecrire('Le locataire peut demander au bailleur de compléter l’état des lieux d’entrée dans les dix jours de son établissement (loi du 6 juillet 1989, art. 3-2). Cette annexe reprend ses demandes et la réponse du bailleur à chacune.', { taille: 9, couleur: discret, apres: 10 });
  if (!d.reserves.length) ecrire('Aucune réserve n’a été déposée.');
  d.reserves.forEach((r, i) => {
    ecrire(`Réserve n° ${i + 1} — ${r.de}, le ${instant(r.created_at)}`, { g: true });
    ecrire(r.texte, { apres: 2 });
    ecrire(r.statut === 'demande' ? 'Réponse du bailleur : en attente.' : `Réponse du bailleur, le ${r.repondu_le ? instant(r.repondu_le) : '—'} : ${STATUTS_RESERVE[r.statut].toLowerCase()}${r.reponse ? ` — ${r.reponse}` : '.'}`, { couleur: discret, apres: 12 });
  });
  ecrire(`Annexe éditée le ${instant(new Date().toISOString())} avec Constatio.`, { taille: 8, couleur: discret });
  return pdf.save();
}
