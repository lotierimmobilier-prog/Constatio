// L'assistant du site : il retrouve, parmi des réponses déjà rédigées et relues (questions des
// guides, questions sur le fonctionnement), celle qui correspond à la question posée.
// Il ne rédige rien lui-même : sur un sujet juridique, mieux vaut une réponse sourcée que
// l'on retrouve qu'une réponse inventée. Tout se passe sur l'appareil ; rien n'est envoyé.

export interface Fiche { q: string; r: string; url?: string | null; source?: string; /** Autres mots par lesquels on pose la même question. */ mots?: string }

/** Le fonctionnement du site. Chaque réponse décrit ce que l'application fait réellement. */
export const FONCTIONNEMENT: Fiche[] = [
  { q: 'Combien coûte un état des lieux ?', mots: 'prix tarif cher payant gratuit montant', r: 'La saisie, le brouillon et l’aperçu sont gratuits. Vous payez un crédit au moment de générer le document définitif : 14,90 € à l’unité, moins cher en pack (entrée + sortie, 5 ou 10 crédits) ou avec un abonnement Premium. Les prix à jour sont dans « Crédits et abonnement ».', url: '/#tarifs', source: 'Tarifs' },
  { q: 'Quand est-ce que je paie ? Le brouillon est-il gratuit ?', r: 'Vous ne payez qu’à la génération du document définitif. Vous pouvez préparer tout l’état des lieux, le relire et ouvrir l’aperçu sans rien payer.' },
  { q: 'Comment acheter des crédits ou m’abonner ?', r: 'Dans votre espace, touchez le nombre de crédits en haut du tableau de bord, puis choisissez une offre. Le paiement se fait par carte sur la page sécurisée de Stripe ; les crédits arrivent sur votre compte quelques instants après.', url: '/app/credits', source: 'Crédits et abonnement' },
  { q: 'Comment résilier mon abonnement ou retrouver mes factures ?', mots: 'arrêter annuler stopper facture reçu', r: 'Dans « Crédits et abonnement », le bouton « Mon abonnement et mes factures » ouvre votre espace de facturation : vous y résiliez en ligne à tout moment et y téléchargez vos factures. La résiliation prend effet à la fin de la période payée.', url: '/app/credits', source: 'Crédits et abonnement' },
  { q: 'Puis-je me rétracter ou être remboursé ?', r: 'Vous avez quatorze jours pour vous rétracter d’un achat de crédits : les crédits non utilisés sont remboursés. Un crédit déjà utilisé pour générer un document ne l’est plus, car vous demandez alors expressément la fourniture immédiate du document.', url: '/cgv', source: 'Conditions générales, article 7' },
  { q: 'Est-ce que ça marche sans réseau, hors connexion ?', mots: 'internet wifi 4G cave offline déconnecté', r: 'Oui. Toute la visite se fait sans réseau : états, observations et photos sont gardés sur le téléphone et envoyés dès que la connexion revient. Un bandeau en haut de l’écran indique l’avancement de l’envoi. Seules la génération du document définitif et la signature demandent une connexion.' },
  { q: 'Comment créer un état des lieux ?', r: 'Dans votre espace, touchez « Nouvel état des lieux », choisissez le type (entrée, sortie ou relevé) et le modèle de logement, saisissez l’adresse, puis « Créer le brouillon ». Les pièces et leurs éléments sont déjà en place : vous n’avez plus qu’à les parcourir.', url: '/app/edl/nouveau', source: 'Nouvel état des lieux' },
  { q: 'Comment faire un état des lieux de sortie à partir de l’entrée ?', r: 'En créant un état des lieux de sortie, choisissez l’état des lieux d’entrée correspondant : pièces, éléments et parties sont repris. Pour chaque élément, l’état d’entrée s’affiche à côté, et « Inchangé depuis l’entrée » le reprend d’un geste. Dans le document, les écarts sont mis en évidence.' },
  { q: 'Comment ajouter des photos ?', r: 'Dans une pièce, ouvrez « Détail » sur un élément puis ajoutez une ou plusieurs photos. Chaque photo est réduite, datée et, si vous l’autorisez, localisée ; vous pouvez lui donner une légende. Elles figurent dans l’annexe du document, numérotées.' },
  { q: 'Comment mettre un filigrane sur les photos ?', mots: 'tampon marquage watermark horodatage', r: 'Dans « Mon compte », section « Présentation des documents », cochez « Filigrane sur les photos » et choisissez le texte. Un bandeau au pied de chaque photo du document porte ce texte, la date et l’heure. Vos photos d’origine ne sont pas modifiées.', url: '/app/compte', source: 'Mon compte' },
  { q: 'Comment mettre mon logo sur l’état des lieux ?', mots: 'agence marque en-tête personnaliser professionnel cabinet', r: 'C’est réservé aux comptes professionnels. Dans « Mon compte », choisissez le type « Professionnel », puis déposez votre logo dans « Présentation des documents » : il apparaît en tête de l’aperçu et du document définitif.', url: '/app/compte', source: 'Mon compte' },
  { q: 'Comment faire signer le locataire ? Doit-il créer un compte ?', mots: 'signature signer inscription bailleur', r: 'Non, il n’a pas de compte à créer. Une fois le document généré, chaque partie signe au doigt sur votre écran (« Signer ici »), ou à distance par un lien personnel que vous lui transmettez (« Signer à distance »). Chacun confirme d’abord avoir lu le document.' },
  { q: 'Quelle différence entre la signature à la main et la signature électronique DocuSeal ?', mots: 'docuseal certifiée option 5 euros électronique mail', r: 'La signature à la main sur l’écran est comprise dans le crédit : chacun signe au doigt, la date et l’heure sont enregistrées. La signature électronique DocuSeal est une option à 5 € par état des lieux : chaque partie reçoit un e-mail et signe depuis son propre appareil, et DocuSeal joint son certificat au document. On choisit l’une ou l’autre, une fois le document généré.' },
  { q: 'Comment remettre son exemplaire au locataire ?', mots: 'envoyer copie PDF mail transmettre recevoir', r: 'Quand tout le monde a signé, ouvrez « Document » et téléchargez l’exemplaire signé : remettez-le à chaque partie, par e-mail, messagerie ou sur papier. Celui qui a signé à distance le retrouve aussi par son lien pendant trente jours.' },
  { q: 'Puis-je corriger un état des lieux après l’avoir généré ?', mots: 'modifier erreur changer rectifier rouvrir', r: 'Oui, tant que personne n’a signé : « Rouvrir pour corriger » le remet en brouillon, et le nouveau document ne coûte pas de second crédit. Dès qu’une partie a signé, il est figé.' },
  { q: 'Quelle est la valeur de la signature ? Est-elle légale ?', r: 'C’est une signature électronique simple au sens du règlement européen eIDAS : elle est recevable comme preuve. L’exemplaire signé porte un dossier de preuve (date, mode de signature, adresse IP, appareil, empreinte numérique du document).', url: '/cgv', source: 'Conditions générales, article 8' },
  { q: 'Que deviennent mes données et celles du locataire ?', mots: 'RGPD confidentialité vie privée cookies', r: 'Elles sont enregistrées dans l’Union européenne, cloisonnées par compte, et ne sont ni vendues ni utilisées pour de la publicité. Le site ne dépose aucun traceur. Vous pouvez demander l’accès, la rectification ou l’effacement de vos données.', url: '/confidentialite', source: 'Politique de confidentialité' },
  { q: 'J’ai un bail Signabail : l’état des lieux est-il offert ?', r: 'Oui : un bail d’habitation généré sur Signabail donne droit à un crédit pour l’état des lieux d’entrée de ce bail, valable vingt-quatre mois. En passant de Signabail à Constatio, le brouillon est pré-rempli avec l’adresse, les parties et les pièces.' },
  { q: 'Peut-on être plusieurs sur un même compte ? Comment ajouter un commercial ?', mots: 'équipe collaborateur agence utilisateur inviter droits accès agent', r: 'Oui, sur un compte professionnel. Dans « Mon compte », section « Équipe », l’administrateur crée un lien d’invitation pour chaque collaborateur, qui se crée alors son propre identifiant. Le collaborateur saisit des états des lieux, sans accès aux crédits ni aux factures ; l’administrateur choisit s’il peut générer les documents, voir les états des lieux de ses collègues et supprimer des brouillons.', url: '/app/compte', source: 'Mon compte' },
  { q: 'Comment recueillir les réserves du locataire avec Constatio ?', mots: 'réserves lien annexe valider refuser dix jours', r: 'Oui : il a dix jours pour demander à compléter l’état des lieux d’entrée. Une fois le document signé, ouvrez « Document » et créez son lien de réserves : il y dépose ses constats sans créer de compte. Vous acceptez ou refusez chacune avec votre réponse, puis téléchargez l’annexe des réserves à joindre à l’état des lieux.' },
  { q: 'Comment vous contacter ?', mots: 'contact téléphone mail aide support joindre', r: 'Écrivez-nous à bonjour@constatio.fr : Constatio et Signabail sont édités par la même société, LOTIER, à Béziers.', url: '/mentions-legales', source: 'Mentions légales' },
];

const VIDES = new Set('les des une aux avec pour dans sur par que qui quoi est sont pas plus mon mes ton son ses nos vos leur leurs cette ces cet elle ils elles nous vous faire fait faut peut dois doit comment quand quel quelle quels quelles est-ce combien etre avoir ete tres tout tous toute alors donc mais ou et de du la le un je tu il on y a en au ce se sa ne si'.split(' '));

/** Minuscules, sans accents ni ponctuation. */
export const normaliser = (texte: string) => texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`-]/g, ' ').replace(/[^a-z0-9 ]/g, ' ');
/** Les mots qui portent le sens, ramenés à une racine grossière (pluriels, terminaisons). */
export function racines(texte: string): string[] {
  return normaliser(texte).split(/\s+/).filter((m) => m.length > 2 && !VIDES.has(m))
    .map((m) => m.replace(/(ements?|ations?|euses?|eurs?|ent|ees?|es|er|ez|ir|s|x|e)$/, '')).map((m) => m.slice(0, 7)).filter((m) => m.length > 2);
}

export interface Index { fiches: Fiche[]; q: Set<string>[]; r: Set<string>[]; poids: Map<string, number> }
export function indexer(fiches: Fiche[]): Index {
  const q = fiches.map((f) => new Set(racines(`${f.q} ${f.mots ?? ''}`)));
  const r = fiches.map((f) => new Set(racines(`${f.r} ${f.source ?? ''}`)));
  const presence = new Map<string, number>();
  fiches.forEach((_, i) => new Set([...q[i], ...r[i]]).forEach((m) => presence.set(m, (presence.get(m) ?? 0) + 1)));
  // Un mot rare distingue mieux une fiche qu'un mot présent partout (« état », « lieux »).
  const poids = new Map([...presence].map(([m, n]) => [m, Math.log(1 + fiches.length / n)]));
  return { fiches, q, r, poids };
}

export interface Trouve { fiche: Fiche; score: number }
/** Les fiches qui répondent le mieux, de la meilleure à la moins bonne. Vide si rien ne correspond vraiment. */
export function chercher(index: Index, question: string, combien = 3): Trouve[] {
  const mots = [...new Set(racines(question))];
  if (!mots.length) return [];
  const total = mots.reduce((s, m) => s + (index.poids.get(m) ?? 0), 0);
  if (total === 0) return [];
  const resultats = index.fiches.map((fiche, i) => {
    let score = 0;
    for (const m of mots) {
      const p = index.poids.get(m) ?? 0;
      if (index.q[i].has(m)) score += 3 * p; else if (index.r[i].has(m)) score += p;
    }
    return { fiche, score: score / (3 * total) };
  });
  // En dessous de ce seuil, la ressemblance tient du hasard : mieux vaut dire « je ne sais pas ».
  return resultats.filter((x) => x.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, combien);
}
