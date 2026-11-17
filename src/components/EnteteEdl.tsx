import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { chargerEdl } from '../lib/edl';
import { Alerte } from './ui';

/** En-tête commun des étapes d'un EDL : retour, titre, et le verrou une fois signé. */
export function useVerrou(): { id: string; verrouille: boolean } {
  const { id } = useParams();
  const [verrouille, setVerrouille] = useState(false);
  useEffect(() => {
    void chargerEdl(id!).then((r) => setVerrouille(r?.edl.statut === 'signe'));
  }, [id]);
  return { id: id!, verrouille };
}

export function EnteteEdl({ id, titre, intro, verrouille }: { id: string; titre: string; intro?: string; verrouille: boolean }) {
  return (
    <>
      <Link to={`/app/edl/${id}`} className="text-sm font-semibold text-marque">← Retour à l’état des lieux</Link>
      <h1 className="text-2xl font-bold">{titre}</h1>
      {intro && <p className="text-sm text-discret">{intro}</p>}
      {verrouille && <Alerte ton="info">État des lieux signé : il ne peut plus être modifié.</Alerte>}
    </>
  );
}
