import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Alerte, Bouton } from './ui';

// Affiché seulement quand la connexion Google est configurée dans le projet Supabase
// (identifiants Google à créer par le propriétaire du site) : VITE_CONNEXION_GOOGLE=1.
export const GOOGLE_ACTIF = import.meta.env.VITE_CONNEXION_GOOGLE === '1';

/** Inscription et connexion avec un compte Google : le compte Constatio est créé au premier passage. */
export function BoutonGoogle({ libelle }: { libelle: string }) {
  const [erreur, setErreur] = useState(false);
  if (!GOOGLE_ACTIF) return null;
  return (
    <div className="flex flex-col gap-2">
      <Bouton variante="contour" onClick={async () => {
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/app` } });
        if (error) setErreur(true);
      }}>
        {libelle}
      </Bouton>
      {erreur && <Alerte>La connexion avec Google n’a pas pu démarrer. Réessayez, ou utilisez votre adresse e-mail.</Alerte>}
    </div>
  );
}
