import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Link } from 'react-router-dom';
import { Alerte, Carte, classesBouton } from '../../components/ui';
import type { EdlLigne } from '../../lib/edl';
import { local } from '../../lib/local';
import { supabase } from '../../lib/supabase';

interface LigneEdl {
  id: string;
  type: 'entrant' | 'sortant' | 'releve';
  statut: 'brouillon' | 'termine' | 'signe';
  source?: string;
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

  useEffect(() => {
    if (!organisation) return;
    let actif = true;
    void (async () => {
      await local.tirerListe(organisation.id);
      const logements = await local.lister<{ id: string; libelle: string; ville: string }>('logements', 'organisation_id', organisation.id);
      const lignes = await local.lister<EdlLigne>('edl', 'organisation_id', organisation.id);
      const date = (e: EdlLigne) => e.updated_at ?? e._cree ?? e.date_edl;
      if (actif) setEdl(lignes.sort((x, y) => date(y).localeCompare(date(x))).map((e) => ({ ...e, logements: logements.find((l) => l.id === e.logement_id) ?? null })));
    })();
    // Le solde de crédits ne se lit qu'en ligne ; hors connexion, on affiche le dernier connu.
    const cle = `constatio.credits.${organisation.id}`;
    supabase.from('credit_lots').select('restant').eq('organisation_id', organisation.id).gt('expire_le', new Date().toISOString()).then(({ data, error }) => {
      if (!actif) return;
      if (error) return setCredits(Number(localStorage.getItem(cle) ?? 0));
      const total = data.reduce((s, l) => s + l.restant, 0);
      localStorage.setItem(cle, String(total));
      setCredits(total);
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
      <Link to="/app/edl/nouveau" className={classesBouton('plein')}>
        Nouvel état des lieux
      </Link>
      {edl && edl.length === 0 && (
        <Carte>
          <h2 className="text-lg font-bold">Aucun état des lieux pour l’instant</h2>
          <p className="text-discret">
            Vos états des lieux apparaîtront ici, avec leur statut : brouillon, terminé, puis signé. Le brouillon est gratuit.
          </p>
          <Alerte ton="info">Sans état des lieux d’entrée précis, une retenue sur le dépôt de garantie est très difficile à justifier.</Alerte>
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
            {e.source === 'signabail' && e.statut === 'brouillon' && <span className="font-semibold text-marque"> · offert avec votre bail Signabail</span>}
          </span>
        </Link>
      ))}
    </>
  );
}
