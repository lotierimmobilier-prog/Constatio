import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Link } from 'react-router-dom';
import { Alerte, Carte, classesBouton } from '../../components/ui';
import { supabase } from '../../lib/supabase';

interface LigneEdl {
  id: string;
  type: 'entrant' | 'sortant' | 'releve';
  statut: 'brouillon' | 'termine' | 'signe';
  date_edl: string;
  logements: { libelle: string; ville: string } | null;
}

const TYPES = { entrant: 'Entrée', sortant: 'Sortie', releve: 'Relevé d’état' } as const;
const STATUTS = {
  brouillon: { libelle: 'Brouillon', couleur: 'text-usage' },
  termine: { libelle: 'Terminé', couleur: 'text-mauvais' },
  signe: { libelle: 'Signé', couleur: 'text-neuf' },
} as const;

export function TableauDeBord() {
  const { profil, organisation } = useAuth();
  const [edl, setEdl] = useState<LigneEdl[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    if (!organisation) return;
    let actif = true;
    Promise.all([
      supabase
        .from('edl')
        .select('id, type, statut, date_edl, logements(libelle, ville)')
        .eq('organisation_id', organisation.id)
        .order('updated_at', { ascending: false }),
      supabase.from('credit_lots').select('restant').eq('organisation_id', organisation.id).gt('expire_le', new Date().toISOString()),
    ]).then(([a, b]) => {
      if (!actif) return;
      if (a.error || b.error) return setErreur(true);
      setEdl(a.data as unknown as LigneEdl[]);
      setCredits(b.data.reduce((s, l) => s + l.restant, 0));
    });
    return () => {
      actif = false;
    };
  }, [organisation]);

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Bonjour{profil?.prenom ? ` ${profil.prenom}` : ''}</h1>
        <p className="text-sm text-discret" data-testid="credits">
          {credits === null ? '' : `${credits} crédit${credits > 1 ? 's' : ''}`}
        </p>
      </div>
      {erreur && <Alerte>Impossible de charger vos états des lieux. Vérifiez votre connexion puis rechargez la page.</Alerte>}
      <Link to="/app/edl/nouveau" className={classesBouton('plein')}>
        Nouvel état des lieux
      </Link>
      {edl && edl.length === 0 && (
        <Carte>
          <h2 className="text-lg font-bold">Aucun état des lieux pour l’instant</h2>
          <p className="text-discret">
            Vos états des lieux apparaîtront ici, avec leur statut : brouillon, terminé, puis signé. Le brouillon est gratuit.
          </p>
          <Alerte ton="info">Sans état des lieux d’entrée, aucune dégradation n’est opposable au locataire à la sortie.</Alerte>
        </Carte>
      )}
      {edl?.map((e) => (
        <Link key={e.id} to={`/app/edl/${e.id}`} className="flex flex-col gap-1 rounded-2xl border border-trait bg-surface p-4">
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-semibold">{e.logements?.libelle ?? 'Logement'}</span>
            <span className={`whitespace-nowrap rounded-full border border-current px-2 text-xs font-semibold ${STATUTS[e.statut].couleur}`}>
              {STATUTS[e.statut].libelle}
            </span>
          </span>
          <span className="text-sm text-discret">
            {TYPES[e.type]} · {e.logements?.ville} · {new Date(e.date_edl).toLocaleDateString('fr-FR')}
          </span>
        </Link>
      ))}
    </>
  );
}
