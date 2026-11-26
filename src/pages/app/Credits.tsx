import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Alerte, Bouton, Carte } from '../../components/ui';
import { supabase } from '../../lib/supabase';

interface Tarif { code: string; libelle: string; montant_cents: number; periodicite: 'unique' | 'mensuel'; credits: number; validite_mois: number }
interface Lot { id: string; origine: string; restant: number; quantite: number; expire_le: string; type_reserve: string | null }
interface Abonnement { tarif_code: string; statut: 'actif' | 'impaye' | 'resilie'; periode_fin: string }

/** Ce qui s'achète en ligne, dans l'ordre d'affichage. Les prix, eux, viennent de la base. */
const EN_LIGNE = ['edl_unite', 'pack_entree_sortie', 'pack_5', 'pack_10', 'premium_investisseur', 'premium_pro'];
const ORIGINES: Record<string, string> = { achat: 'Achat', abonnement: 'Abonnement', signabail: 'Offert avec un bail Signabail', geste_commercial: 'Offert par Constatio' };
const euros = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const MOTIFS: Record<string, string> = {
  ferme: 'Le paiement en ligne n’est pas encore ouvert.',
  deja_abonne: 'Vous avez déjà un abonnement en cours. Gérez-le depuis « Mon abonnement et mes factures ».',
  sans_achat: 'Aucun achat n’est encore enregistré sur ce compte.',
  session: 'Votre session a expiré : reconnectez-vous.',
};

/** Solde de crédits, abonnement, et achat par carte bancaire sur la page de paiement Stripe. */
export function Credits() {
  const { organisation, estAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tarifs, setTarifs] = useState<Tarif[]>([]);
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [abonnement, setAbonnement] = useState<Abonnement | null>(null);
  const [essai, setEssai] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [accepte, setAccepte] = useState(false);
  const retour = params.get('paiement');

  const charger = useCallback(async () => {
    if (!organisation) return;
    const maintenant = new Date().toISOString();
    const [t, l, a, m] = await Promise.all([
      supabase.from('tarifs').select('code, libelle, montant_cents, periodicite, credits, validite_mois').in('code', EN_LIGNE),
      supabase.from('credit_lots').select('id, origine, restant, quantite, expire_le, type_reserve').eq('organisation_id', organisation.id).gt('expire_le', maintenant).gt('restant', 0).order('expire_le'),
      supabase.from('abonnements').select('tarif_code, statut, periode_fin').eq('organisation_id', organisation.id).in('statut', ['actif', 'impaye']).gt('periode_fin', maintenant).limit(1).maybeSingle(),
      supabase.from('parametres').select('valeur').eq('cle', 'mode_test').maybeSingle(),
    ]);
    if (t.error || l.error) return setErreur('Vos crédits ne se consultent qu’avec une connexion. Réessayez dès que le réseau revient.');
    setTarifs((t.data as Tarif[]).sort((x, y) => EN_LIGNE.indexOf(x.code) - EN_LIGNE.indexOf(y.code)));
    setLots(l.data as Lot[]);
    setAbonnement((a.data as Abonnement | null) ?? null);
    setEssai(m.data?.valeur === true);
  }, [organisation]);
  useEffect(() => { void charger(); }, [charger]);
  // Après un paiement, les crédits arrivent par un message de Stripe : on regarde à nouveau pendant quelques secondes.
  useEffect(() => {
    if (retour !== 'ok') return;
    const minuteries = [2000, 5000, 10_000, 20_000].map((d) => setTimeout(() => void charger(), d));
    return () => minuteries.forEach(clearTimeout);
  }, [retour, charger]);

  async function aller(corps: Record<string, string>, cle: string) {
    setOccupe(cle); setErreur(null);
    const { data, error } = await supabase.functions.invoke('paiement', { body: corps });
    let reponse = data as { statut: string; url?: string; motif?: string } | null;
    if (error) { try { reponse = await (error as { context?: Response }).context?.json(); } catch { reponse = null; } }
    if (reponse?.statut === 'ok' && reponse.url) { window.location.assign(reponse.url); return; }
    setOccupe(null);
    setErreur(MOTIFS[reponse?.motif ?? ''] ?? 'Le paiement n’a pas pu être préparé. Rien n’a été débité : réessayez dans un instant.');
  }

  if (!estAdmin) return <Alerte ton="info">Les crédits, l’abonnement et les factures sont gérés par l’administrateur de votre compte.</Alerte>;
  const solde = lots?.reduce((s, l) => s + l.restant, 0) ?? 0;
  const libelle = (code: string) => tarifs.find((t) => t.code === code)?.libelle ?? code;
  const achats = tarifs.filter((t) => t.periodicite === 'unique');
  const abonnements = tarifs.filter((t) => t.periodicite === 'mensuel');
  const offre = (t: Tarif) => (
    <li key={t.code} className="flex items-center justify-between gap-3 rounded-xl border border-trait p-3" data-testid={`offre-${t.code}`}>
      <span className="min-w-0">
        <span className="block font-semibold">{t.libelle}</span>
        <span className="block text-sm text-discret">
          {t.periodicite === 'mensuel' ? `${t.credits} états des lieux par an, sans engagement` : `${t.credits} crédit${t.credits > 1 ? 's' : ''}, valable${t.credits > 1 ? 's' : ''} ${t.validite_mois} mois`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-bold tabular-nums">{euros(t.montant_cents)}{t.periodicite === 'mensuel' ? ' / mois' : ''}</span>
        <Bouton disabled={!accepte || occupe !== null || (t.periodicite === 'mensuel' && abonnement !== null)} onClick={() => aller({ action: 'commander', tarif: t.code }, t.code)}>
          {occupe === t.code ? 'Ouverture…' : t.periodicite === 'mensuel' ? 'S’abonner' : 'Acheter'}
        </Bouton>
      </span>
    </li>
  );

  return (
    <>
      <h1 className="text-2xl font-bold">Crédits et abonnement</h1>
      {retour === 'ok' && <Alerte ton="succes">Paiement reçu, merci. Vos crédits apparaissent ci-dessous sous quelques instants. <button type="button" className="font-semibold underline" onClick={() => setParams({})}>Fermer</button></Alerte>}
      {retour === 'annule' && <Alerte ton="info">Paiement abandonné : rien n’a été débité. <button type="button" className="font-semibold underline" onClick={() => setParams({})}>Fermer</button></Alerte>}
      {erreur && <Alerte>{erreur}</Alerte>}
      {essai && <Alerte ton="info">Mode test : aucun paiement réel. Sur la page de paiement, utilisez la carte de démonstration 4242 4242 4242 4242, une date à venir et trois chiffres quelconques.</Alerte>}

      <Carte>
        <p className="text-sm text-discret">Solde</p>
        <p className="text-3xl font-bold tabular-nums" data-testid="solde">{lots === null ? '…' : `${solde} crédit${solde > 1 ? 's' : ''}`}</p>
        <p className="text-sm text-discret">Un crédit sert à générer le document définitif d’un état des lieux. Saisie, brouillons et aperçu restent gratuits.</p>
        {lots && lots.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {lots.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 border-t border-trait pt-1">
                <span>{ORIGINES[l.origine] ?? l.origine}{l.type_reserve === 'entrant' ? ' (entrée uniquement)' : ''}</span>
                <span className="whitespace-nowrap text-discret">{l.restant} sur {l.quantite} · jusqu’au {jour(l.expire_le)}</span>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {abonnement && (
        <Carte>
          <h2 className="text-lg font-bold" data-testid="abonnement">{libelle(abonnement.tarif_code)}</h2>
          {abonnement.statut === 'actif'
            ? <p className="text-sm">Abonnement actif. Prochaine échéance le {jour(abonnement.periode_fin)}.</p>
            : <Alerte>La dernière échéance n’a pas pu être prélevée : vos avantages Premium sont suspendus. Mettez à jour votre carte ci-dessous.</Alerte>}
        </Carte>
      )}

      <label className="flex items-start gap-2 rounded-xl border border-trait bg-surface p-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} data-testid="accepter-cgv" />
        <span>J’ai lu et j’accepte les <Link to="/cgv" target="_blank" className="font-semibold text-marque underline underline-offset-4">conditions générales de vente</Link>, dont le droit de rétractation de quatorze jours (article 7). Commande avec obligation de paiement.</span>
      </label>
      <h2 className="mt-2 text-lg font-bold">Acheter des crédits</h2>
      <ul className="flex flex-col gap-2">{achats.map(offre)}</ul>
      <h2 className="mt-2 text-lg font-bold">Abonnements Premium</h2>
      <ul className="flex flex-col gap-2">{abonnements.map(offre)}</ul>
      <p className="text-sm text-discret">Prix toutes taxes comprises. Paiement par carte bancaire sur la page sécurisée de Stripe : Constatio ne voit jamais votre numéro de carte.</p>
      <Bouton variante="contour" disabled={occupe !== null} onClick={() => aller({ action: 'portail' }, 'portail')}>{occupe === 'portail' ? 'Ouverture…' : 'Mon abonnement et mes factures'}</Bouton>
    </>
  );
}
