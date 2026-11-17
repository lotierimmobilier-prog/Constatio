import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { PageAuth } from '../components/PageAuth';
import { Alerte, Bouton, Champ } from '../components/ui';
import { traduireErreur } from '../lib/erreurs';
import { supabase } from '../lib/supabase';
import { LONGUEUR_MOT_DE_PASSE, motDePasseValide } from '../lib/validation';

/** Page d'arrivée du lien reçu par e-mail : le lien ouvre une session, il reste à choisir le mot de passe. */
export function NouveauMotDePasse() {
  const { session, chargement } = useAuth();
  const aller = useNavigate();
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    if (!motDePasseValide(motDePasse)) return setErreur(`Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`);
    setOccupe(true);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    setOccupe(false);
    if (error) setErreur(traduireErreur(error));
    else aller('/app', { replace: true });
  }

  if (chargement) return <p className="p-8 text-center text-discret">Chargement…</p>;

  return (
    <PageAuth titre="Nouveau mot de passe">
      {session ? (
        <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
          {erreur && <Alerte>{erreur}</Alerte>}
          <Champ id="mot-de-passe" libelle="Nouveau mot de passe" type="password" autoComplete="new-password" required value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} aide={`Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`} />
          <Bouton type="submit" occupe={occupe}>
            Enregistrer
          </Bouton>
        </form>
      ) : (
        <>
          <Alerte>Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.</Alerte>
          <Link to="/mot-de-passe-oublie" className="text-center text-sm font-semibold text-marque underline-offset-4 hover:underline">
            Recevoir un nouveau lien
          </Link>
        </>
      )}
    </PageAuth>
  );
}
