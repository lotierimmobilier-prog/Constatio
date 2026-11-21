import { Link } from 'react-router-dom';
import { Alerte } from '../../components/ui';
import { appel } from '../../lib/admin';
import { useDonnee } from './CoquilleAdmin';

interface Tableau {
  mode_test: boolean; comptes: number; comptes_7j: number; comptes_test: number; edl: Record<string, number>; edl_30j: number;
  credits_en_circulation: number; credits_consommes_30j: number; credits_offerts_signabail: number; abonnements_actifs: number;
  reservations_a_traiter: number; signabail_en_attente: number; signabail_en_erreur: number; comptes_lies_signabail: number;
}

function Chiffre({ libelle, valeur, detail }: { libelle: string; valeur: number | string; detail?: string }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-sm text-discret">{libelle}</dt>
      <dd className="font-titre text-3xl font-bold tabular-nums">{valeur}</dd>
      {detail && <dd className="text-sm text-discret">{detail}</dd>}
    </div>
  );
}

export function AdminAccueil() {
  const { donnee: t, erreur } = useDonnee(() => appel<Tableau>('admin_tableau_de_bord'));
  if (erreur) return <Alerte>{erreur}</Alerte>;
  if (!t) return <p className="text-discret">Chargement…</p>;
  const edl = (s: string) => t.edl[s] ?? 0;
  return (
    <>
      <h1 className="text-2xl font-bold">Tableau de bord</h1>
      {t.mode_test
        ? <Alerte ton="info">Mode test actif : aucun e-mail, aucune signature ni aucun paiement réels.</Alerte>
        : <Alerte ton="succes">Le service est en production : e-mails, signatures et paiements sont réels.</Alerte>}
      {(t.signabail_en_erreur > 0 || t.reservations_a_traiter > 0) && (
        <Alerte>
          {t.signabail_en_erreur > 0 && <span>{t.signabail_en_erreur} message{t.signabail_en_erreur > 1 ? 's' : ''} Signabail en erreur. <Link to="/admin/signabail" className="font-semibold underline">Voir</Link> </span>}
          {t.reservations_a_traiter > 0 && <span>{t.reservations_a_traiter} prestation{t.reservations_a_traiter > 1 ? 's' : ''} sur place à traiter.</span>}
        </Alerte>
      )}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-trait bg-trait lg:grid-cols-4" data-testid="chiffres">
        <Chiffre libelle="Comptes" valeur={t.comptes} detail={`+${t.comptes_7j} sur 7 jours · ${t.comptes_test} de test`} />
        <Chiffre libelle="États des lieux" valeur={edl('brouillon') + edl('termine') + edl('signe')} detail={`${t.edl_30j} créés sur 30 jours`} />
        <Chiffre libelle="Signés" valeur={edl('signe')} detail={`${edl('termine')} terminés · ${edl('brouillon')} brouillons`} />
        <Chiffre libelle="Abonnements actifs" valeur={t.abonnements_actifs} />
        <Chiffre libelle="Crédits en circulation" valeur={t.credits_en_circulation} detail="non consommés, non expirés" />
        <Chiffre libelle="Crédits consommés" valeur={t.credits_consommes_30j} detail="sur 30 jours" />
        <Chiffre libelle="Offerts par Signabail" valeur={t.credits_offerts_signabail} detail={`${t.comptes_lies_signabail} compte${t.comptes_lies_signabail > 1 ? 's' : ''} relié${t.comptes_lies_signabail > 1 ? 's' : ''}`} />
        <Chiffre libelle="Messages Signabail en attente" valeur={t.signabail_en_attente} detail="client pas encore inscrit" />
      </dl>
      <p className="text-sm text-discret">Les comptes de test ne sont pas comptés dans « Comptes ». Le chiffre d’affaires apparaîtra ici avec le paiement en ligne.</p>
    </>
  );
}
