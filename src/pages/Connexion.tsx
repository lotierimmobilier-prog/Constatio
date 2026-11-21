import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BoutonGoogle } from '../components/BoutonGoogle';
import { PageAuth } from '../components/PageAuth';
import { Alerte, Bouton, Champ } from '../components/ui';
import { traduireErreur } from '../lib/erreurs';
import { supabase } from '../lib/supabase';

export function Connexion() {
  const { session } = useAuth();
  const aller = useNavigate();
  const retour = (useLocation().state as { retour?: string } | null)?.retour ?? '/app';
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  if (session) return <Navigate to={retour} replace />;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setOccupe(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: motDePasse });
    setOccupe(false);
    if (error) setErreur(traduireErreur(error));
    else aller(retour, { replace: true });
  }

  return (
    <PageAuth titre="Connexion" intro="Retrouvez vos états des lieux et vos crédits.">
      <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
        {erreur && <Alerte>{erreur}</Alerte>}
        <Champ id="email" libelle="Adresse e-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Champ id="mot-de-passe" libelle="Mot de passe" type="password" autoComplete="current-password" required value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
        <Bouton type="submit" occupe={occupe} disabled={!email || !motDePasse}>
          Se connecter
        </Bouton>
        <Link to="/mot-de-passe-oublie" className="text-center text-sm font-semibold text-marque underline-offset-4 hover:underline">
          Mot de passe oublié ?
        </Link>
      </form>
      <div className="flex flex-col gap-2 border-t border-trait pt-6">
        <BoutonGoogle libelle="Se connecter avec Google" />
        <Bouton variante="contour" disabled aria-describedby="signabail-bientot">
          Se connecter avec Signabail
        </Bouton>
        <p id="signabail-bientot" className="text-center text-sm text-discret">
          Bientôt disponible : vous utiliserez votre compte Signabail sans créer de mot de passe.
        </p>
      </div>
      <p className="text-center text-sm">
        Pas encore de compte ?{' '}
        <Link to="/inscription" className="font-semibold text-marque underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </PageAuth>
  );
}
