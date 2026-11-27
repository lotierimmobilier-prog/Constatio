// Les e-mails de la vie d'un état des lieux finalisé : un texte par événement et par destinataire.
//   signe      après les signatures            depot      une réserve est déposée
//   reponse    une réserve est acceptée/refusée cloture   le délai de dix jours s'achève
// Fonctions pures : la rédaction se teste sans base ni messagerie.
export type Evenement = 'signe' | 'depot' | 'reponse' | 'cloture';
export type Role = 'bailleur' | 'locataire' | 'mandataire_bailleur' | 'mandataire_locataire';
export interface Contexte {
  type: string;               // entrant, sortant…
  lieu: string;               // adresse complète du logement
  signeLe: string;            // déjà mis en forme
  limite: string | null;      // fin du délai de dix jours, mise en forme (entrée seulement)
  reserve?: { auteur: string; piece: string | null; texte: string; photos: number; statut: 'demande' | 'accepte' | 'refuse'; reponse: string | null };
  bilan?: { total: number; acceptees: number; refusees: number; attente: number };
}
export interface Destinataire { nom: string; role: Role; represente: string | null; estAuteur?: boolean }
export interface Redaction { sujet: string; titre: string; paragraphes: string[]; bouton: string; apres: string[] }

const QUOI: Record<string, string> = { entrant: 'état des lieux d’entrée', sortant: 'état des lieux de sortie' };
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const ART = '(loi du 6 juillet 1989, article 3-2)';

export function rediger(e: Evenement, d: Destinataire, c: Contexte): Redaction {
  const quoi = QUOI[c.type] ?? 'état des lieux';
  const coteBailleur = d.role === 'bailleur' || d.role === 'mandataire_bailleur';
  const mandataire = d.role === 'mandataire_bailleur' || d.role === 'mandataire_locataire';
  const pourQui = mandataire ? ` Vous recevez ce message en votre qualité de mandataire${d.represente ? ` de ${d.represente}` : coteBailleur ? ' du bailleur' : ' du locataire'}.` : '';
  const bonjour = `Bonjour ${d.nom},`;
  const leLocataire = d.role === 'mandataire_locataire' ? (d.represente ?? 'la personne que vous représentez') : null;
  const r = c.reserve;
  const sur = r ? `${r.piece ? ` (pièce « ${r.piece} »)` : ''}` : '';

  if (e === 'signe') {
    const apres: string[] = [];
    if (c.type === 'entrant' && c.limite) {
      apres.push(coteBailleur
        ? `Le locataire dispose de dix jours, jusqu’au ${c.limite}, pour demander à compléter cet état des lieux ${ART}. Vous serez prévenu par e-mail de chaque réserve, puis de la fin du délai.`
        : `${leLocataire ? `${leLocataire} dispose` : 'Vous disposez'} de dix jours, jusqu’au ${c.limite}, pour demander à compléter cet état des lieux ${ART}. Depuis ce même lien, une réserve se signale en précisant la pièce et en joignant des photos.`);
    }
    if (c.type === 'sortant') {
      apres.push(coteBailleur
        ? 'Le dépôt de garantie se restitue dans un délai d’un mois à compter de la remise des clés si cet état des lieux est conforme à celui d’entrée, de deux mois sinon ; toute retenue doit être justifiée (loi du 6 juillet 1989, article 22).'
        : 'Le dépôt de garantie est restitué dans un délai d’un mois à compter de la remise des clés si cet état des lieux est conforme à celui d’entrée, de deux mois sinon (loi du 6 juillet 1989, article 22). Pensez à communiquer votre nouvelle adresse au bailleur.');
    }
    apres.push('Téléchargez le document et conservez-le. Ce lien vous est personnel : ne le transférez pas.');
    return {
      sujet: `Votre ${quoi} signé — ${c.lieu}`, titre: `L’${quoi} est signé`,
      paragraphes: [bonjour, `L’${quoi} du logement situé ${c.lieu} a été signé par toutes les parties le ${c.signeLe}.${pourQui} Votre exemplaire est disponible par le lien personnel ci-dessous, valable un an.`],
      bouton: 'Ouvrir mon exemplaire signé', apres,
    };
  }

  if (e === 'depot' && r) {
    const citation = `« ${r.texte} »`;
    const joint = r.photos ? `, avec ${pluriel(r.photos, 'photo')}` : '';
    if (d.estAuteur) return {
      sujet: `Votre réserve est enregistrée — ${c.lieu}`, titre: 'Votre réserve est enregistrée',
      paragraphes: [bonjour, `Votre réserve sur l’état des lieux d’entrée du logement situé ${c.lieu}${sur} a bien été enregistrée${joint} :`, citation, 'Le bailleur en est informé. Vous recevrez un e-mail dès qu’il l’aura acceptée ou refusée.'],
      bouton: 'Voir mes réserves', apres: c.limite ? [`Vous pouvez en déposer d’autres jusqu’au ${c.limite}.`] : [],
    };
    if (coteBailleur) return {
      sujet: `Réserve à valider — ${c.lieu}`, titre: 'Une réserve attend une réponse',
      paragraphes: [bonjour, `${r.auteur} a déposé une réserve sur l’état des lieux d’entrée du logement situé ${c.lieu}${sur}${joint} :`, citation, `Elle peut être acceptée ou refusée, avec une réponse, depuis l’espace Constatio de la personne qui a réalisé l’état des lieux.${pourQui}`],
      bouton: 'Voir la réserve et ses photos', apres: ['La réserve et la réponse apportée seront reprises dans l’annexe de l’état des lieux ; le document signé, lui, ne change pas.'],
    };
    return {
      sujet: `Réserve déposée — ${c.lieu}`, titre: 'Une réserve a été déposée',
      paragraphes: [bonjour, `${r.auteur} a déposé une réserve sur l’état des lieux d’entrée du logement situé ${c.lieu}${sur}${joint} :`, citation, `Le bailleur en est informé ; vous serez prévenu de sa réponse.${pourQui}`],
      bouton: 'Voir les réserves', apres: [],
    };
  }

  if (e === 'reponse' && r) {
    const acceptee = r.statut === 'accepte';
    const decision = acceptee ? 'acceptée' : 'refusée';
    const reponse = r.reponse ? [`Réponse du bailleur : « ${r.reponse} »`] : [];
    if (coteBailleur) return {
      sujet: `Réserve ${decision} — ${c.lieu}`, titre: `La réserve a été ${decision}`,
      paragraphes: [bonjour, `La réserve de ${r.auteur} sur l’état des lieux d’entrée du logement situé ${c.lieu}${sur} a été ${decision}.${pourQui}`, `« ${r.texte} »`, ...reponse],
      bouton: 'Ouvrir le document et son annexe', apres: ['La réserve et la réponse figurent dans l’annexe de l’état des lieux, téléchargeable depuis ce lien.'],
    };
    return {
      sujet: `Réserve ${decision} — ${c.lieu}`, titre: d.estAuteur ? `Votre réserve a été ${decision}` : `La réserve a été ${decision}`,
      paragraphes: [bonjour, `${d.estAuteur ? 'Votre réserve' : `La réserve de ${r.auteur}`} sur l’état des lieux d’entrée du logement situé ${c.lieu}${sur} a été ${decision} par le bailleur.${pourQui}`, `« ${r.texte} »`, ...reponse],
      bouton: 'Voir les réserves et l’annexe',
      apres: acceptee ? ['Elle figure désormais dans l’annexe de l’état des lieux, téléchargeable depuis ce lien.'] : [`En cas de désaccord, la commission départementale de conciliation peut être saisie ${ART}.`],
    };
  }

  // Fin du délai de dix jours.
  const b = c.bilan ?? { total: 0, acceptees: 0, refusees: 0, attente: 0 };
  const detail = [b.acceptees ? `${pluriel(b.acceptees, 'acceptée')}` : '', b.refusees ? `${pluriel(b.refusees, 'refusée')}` : '', b.attente ? `${b.attente} en attente de réponse` : ''].filter(Boolean).join(', ');
  const constat = b.total === 0 ? 'Aucune réserve n’a été déposée : l’état des lieux signé reste tel quel.' : `${pluriel(b.total, 'réserve')} ${b.total > 1 ? 'ont été déposées' : 'a été déposée'} : ${detail}. Elles figurent, avec les réponses apportées, dans l’annexe de l’état des lieux.`;
  const apres: string[] = [];
  if (coteBailleur && b.attente) apres.push(`Il reste ${pluriel(b.attente, 'réserve')} sans réponse : elles se traitent depuis l’espace Constatio de la personne qui a réalisé l’état des lieux.`);
  if (!coteBailleur) apres.push(`Pendant le premier mois de la période de chauffe, ${leLocataire ? `${leLocataire} pourra` : 'vous pourrez'} encore demander que l’état des lieux soit complété par l’état des éléments de chauffage ${ART}.`);
  apres.push('Le document signé et son annexe restent disponibles par ce lien pendant un an.');
  return {
    sujet: `Fin du délai de réserves — ${c.lieu}`, titre: 'Le délai de dix jours est terminé',
    paragraphes: [bonjour, `Le délai de dix jours pour demander à compléter l’état des lieux d’entrée du logement situé ${c.lieu} s’est achevé${c.limite ? ` le ${c.limite}` : ''}.${pourQui}`, constat],
    bouton: b.total ? 'Ouvrir le document et son annexe' : 'Ouvrir le document signé', apres,
  };
}
