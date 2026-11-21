import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnteteEdl, useVerrou } from '../../components/EnteteEdl';
import { classesBouton } from '../../components/ui';
import type { Alerte } from '../../lib/controles';
import { chargerEdl, controlerEdl } from '../../lib/edl';

/** Chaque alerte renvoie à l'étape à corriger. */
export function EdlControles() {
  const { id, verrouille } = useVerrou();
  const [alertes, setAlertes] = useState<Alerte[] | null>(null);
  useEffect(() => { void chargerEdl(id).then(() => controlerEdl(id)).then((r) => setAlertes(r?.alertes ?? [])); }, [id]);
  if (!alertes) return <p className="text-center text-discret">Chargement…</p>;

  const bloquants = alertes.filter((a) => a.niveau === 'bloquant');
  const conseils = alertes.filter((a) => a.niveau === 'conseil');
  const ligne = (a: Alerte, i: number) => (
    <li key={i} className={`rounded-r-xl border-l-4 bg-surface px-3 py-2 ${a.niveau === 'bloquant' ? 'border-mauvais' : 'border-repere'}`}>
      <p>{a.message}</p>
      <Link to={`/app/edl/${id}${a.vers ? `/${a.vers}` : ''}`} className="text-sm font-semibold text-marque underline underline-offset-4">{a.action}</Link>
    </li>
  );

  return (
    <>
      <EnteteEdl id={id} titre="Contrôles" intro="Ce qui manque pour que l’état des lieux soit complet au sens du décret du 30 mars 2016." verrouille={verrouille} />
      {bloquants.length === 0 ? (
        <p className="rounded-r-xl border-l-4 border-neuf bg-surface px-3 py-2 font-semibold" data-testid="verdict">Toutes les mentions obligatoires sont renseignées.</p>
      ) : (
        <>
          <h2 className="text-lg font-bold" data-testid="verdict">{bloquants.length} point{bloquants.length > 1 ? 's' : ''} à corriger</h2>
          <ul className="flex flex-col gap-2">{bloquants.map(ligne)}</ul>
        </>
      )}
      {conseils.length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-bold">Conseils</h2>
          <p className="text-sm text-discret">Ils ne bloquent pas le document, mais renforcent sa valeur de preuve.</p>
          <ul className="flex flex-col gap-2">{conseils.map(ligne)}</ul>
        </>
      )}
      <Link to={`/app/edl/${id}/apercu`} className={classesBouton('repere')} data-testid="vers-apercu">Voir l’aperçu</Link>
      <p className="text-center text-sm text-discret">L’aperçu est gratuit et fonctionne sans réseau. Le document définitif se génère à l’étape suivante.</p>
    </>
  );
}
