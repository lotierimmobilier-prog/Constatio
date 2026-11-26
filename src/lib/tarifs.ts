// Les prix affichés sur le site public sont ceux saisis dans l'administration (table « tarifs »).
//   * à la construction du site, ils sont lus dans la base et écrits dans la page (moteurs de recherche, assistants IA) ;
//   * à l'ouverture de la page, ils sont relus : un prix changé dans l'administration s'affiche aussitôt ;
//   * si la base ne répond pas, les derniers prix connus ci-dessous servent de secours.
import { useEffect, useState } from 'react';
import { configure, supabase } from './supabase';

export type Prix = Record<string, number>;
/** Secours : les prix en vigueur au 26 novembre 2026, en centimes. */
export const PRIX_SECOURS: Prix = { edl_unite: 990, pack_entree_sortie: 1490, pack_5: 4500, pack_10: 5900, offre_groupee: 2990, premium_investisseur: 990, premium_pro: 2990, prestation_sur_place: 18000, signature_electronique: 500 };
/** Prix d'un bail seul sur Signabail, pour le « au lieu de » de l'offre groupée. */
const BAIL_SIGNABAIL = 1990;

export const euros = (centimes: number) => `${(centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: centimes % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

const LIGNES: { code: string; nom: string; detail: string; mensuel?: boolean }[] = [
  { code: 'edl_unite', nom: 'État des lieux à l’unité', detail: 'Entrée, sortie ou relevé d’état' },
  { code: 'pack_entree_sortie', nom: 'Pack entrée + sortie', detail: 'Les deux états des lieux d’une même location' },
  { code: 'pack_5', nom: 'Pack 5 crédits', detail: 'Valables 24 mois' },
  { code: 'pack_10', nom: 'Pack 10 crédits', detail: 'Valables 24 mois' },
  { code: 'offre_groupee', nom: 'Bail Signabail + entrée + sortie', detail: 'Le bail et ses deux états des lieux' },
  { code: 'premium_investisseur', nom: 'Premium Investisseur', detail: '12 états des lieux par an, relevés d’état illimités, historique par logement', mensuel: true },
  { code: 'premium_pro', nom: 'Premium Pro', detail: 'Plusieurs utilisateurs, documents à votre en-tête, export vers votre logiciel', mensuel: true },
];
/** Le barème de la page d'accueil : une offre retirée de la vente dans l'administration n'y figure plus. */
export const bareme = (prix: Prix) => LIGNES.filter((l) => prix[l.code] !== undefined).map((l) => ({ ...l, centimes: prix[l.code], prix: `${euros(prix[l.code])}${l.mensuel ? ' / mois' : ''}` }));
/** L'offre groupée et ce qu'elle remplace (bail seul + pack), si elle est bien moins chère. */
export function offreGroupee(prix: Prix): { prix: string; auLieuDe: string | null } | null {
  if (prix.offre_groupee === undefined) return null;
  const separe = prix.pack_entree_sortie !== undefined ? BAIL_SIGNABAIL + prix.pack_entree_sortie : 0;
  return { prix: euros(prix.offre_groupee), auLieuDe: separe > prix.offre_groupee ? euros(separe) : null };
}

/** Les prix écrits dans la page à la construction du site, s'il y en a. */
function prixDeLaPage(): Prix | null {
  const g = globalThis as unknown as { __TARIFS__?: Prix };
  return g.__TARIFS__ && typeof g.__TARIFS__ === 'object' ? g.__TARIFS__ : null;
}

export function useTarifs(): Prix {
  const [prix, setPrix] = useState<Prix>(() => prixDeLaPage() ?? PRIX_SECOURS);
  useEffect(() => {
    if (!configure) return;
    let actif = true;
    void supabase.from('tarifs').select('code, montant_cents').then(({ data }) => {
      if (actif && data?.length) setPrix(Object.fromEntries(data.map((t) => [t.code, t.montant_cents])));
    });
    return () => { actif = false; };
  }, []);
  return prix;
}
