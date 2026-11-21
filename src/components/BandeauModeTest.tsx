import { useEffect, useState } from 'react';
import { configure, supabase } from '../lib/supabase';

/** Rappelle que le coupe-circuit est actif : aucun e-mail, signature ni paiement réels. */
export function BandeauModeTest() {
  const [actif, setActif] = useState(false);
  useEffect(() => {
    if (!configure) return;
    supabase
      .from('parametres')
      .select('valeur')
      .eq('cle', 'mode_test')
      .maybeSingle()
      .then(({ data }) => setActif(data?.valeur === true));
  }, []);
  if (!actif) return null;
  return (
    <div className="bg-repere px-4 py-1 text-center text-xs font-semibold text-sur-repere">
      Mode test : aucun e-mail, aucune signature ni aucun paiement réels.
    </div>
  );
}
