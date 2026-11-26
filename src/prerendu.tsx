// Rendu des pages publiques en HTML à la construction du site (scripts/prerendre.mjs).
// Les moteurs de recherche et les robots des assistants IA lisent ainsi le contenu
// sans exécuter de JavaScript ; le navigateur, lui, reprend la main normalement.
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Contexte } from './auth/contexte';
import { EDITEUR } from './lib/editeur';
import { Accueil, FAQ } from './pages/Accueil';
import { PRIX_SECOURS, bareme, type Prix } from './lib/tarifs';
import { Cgv, Confidentialite, MentionsLegales } from './pages/Legal';

const SITE = 'https://constatio.fr';
const visiteur = { session: null, chargement: false, profil: null, organisation: null, role: null, estAdmin: false, recharger: async () => {}, deconnecter: async () => {} };
const rendre = (chemin: string, page: JSX.Element) =>
  renderToString(<StaticRouter location={chemin}><Contexte.Provider value={visiteur}>{page}</Contexte.Provider></StaticRouter>);

const editeur = { '@type': 'Organization', name: 'Constatio', legalName: `${EDITEUR.nom} ${EDITEUR.forme}`, url: `${SITE}/`, logo: `${SITE}/icone-512.png`,
  address: { '@type': 'PostalAddress', streetAddress: '40 rue Française', postalCode: '34500', addressLocality: 'Béziers', addressCountry: 'FR' }, telephone: EDITEUR.telephone, email: EDITEUR.email };

export interface PagePrerendue { chemin: string; titre: string; description: string; html: string; donnees: unknown[] }

export function pages(): PagePrerendue[] {
  const prix = (globalThis as unknown as { __TARIFS__?: Prix }).__TARIFS__ ?? PRIX_SECOURS;
  return [
    {
      chemin: '/', titre: 'Constatio — l’état des lieux depuis votre téléphone',
      description: 'Réalisez vous-même votre état des lieux d’entrée ou de sortie sur téléphone : pièce par pièce, photos datées, contrôle des mentions obligatoires, signature électronique et PDF. Brouillon gratuit.',
      html: rendre('/', <Accueil />),
      donnees: [
        { '@context': 'https://schema.org', ...editeur },
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Constatio', url: `${SITE}/`, inLanguage: 'fr-FR', publisher: editeur },
        { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Constatio', applicationCategory: 'BusinessApplication', operatingSystem: 'Web (téléphone, tablette, ordinateur)', inLanguage: 'fr-FR', url: `${SITE}/`,
          description: 'Application en ligne pour réaliser un état des lieux locatif (entrée, sortie, relevé d’état) depuis un téléphone, en France.',
          offers: bareme(prix).map((t) => ({ '@type': 'Offer', name: t.nom, description: t.detail, price: (t.centimes / 100).toFixed(2), priceCurrency: 'EUR', url: `${SITE}/#tarifs` })) },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, r]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: r } })) },
      ],
    },
    { chemin: '/mentions-legales/', titre: 'Mentions légales | Constatio', description: 'Éditeur, hébergeurs, activité immobilière et médiateur de la consommation du service Constatio.', html: rendre('/mentions-legales', <MentionsLegales />), donnees: [] },
    { chemin: '/cgv/', titre: 'Conditions générales d’utilisation et de vente | Constatio', description: 'Conditions d’utilisation de Constatio : crédits, abonnements, droit de rétractation, signature électronique, responsabilité.', html: rendre('/cgv', <Cgv />), donnees: [] },
    { chemin: '/confidentialite/', titre: 'Politique de confidentialité et cookies | Constatio', description: 'Données traitées par Constatio, durées de conservation, sous-traitants, droits des personnes et stockage sur l’appareil.', html: rendre('/confidentialite', <Confidentialite />), donnees: [] },
  ];
}
