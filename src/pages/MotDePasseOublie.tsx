import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageAuth } from '../components/PageAuth';
import { Alerte, Bouton, Champ } from '../components/ui';
import { traduireErreur } from '../lib/erreurs';
import { supabase } from '../lib/supabase';
import { emailValide } from '../lib/validation';

export function MotDePasseOublie() {
  const [email, setEmail] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    if (!emailValide(email)) return setErreur('Cette adresse e-mail n’est pas valide.');
    setOccupe(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    });
    setOccupe(false);
    if (error) setErreur(traduireErreur(error));
    else setEnvoye(true);
  }

  return (
    <PageAuth titre="Mot de passe oublié" intro="Indiquez votre adresse : nous vous envoyons un lien pour en choisir un nouveau.">
      {envoye ? (
        // Même message que l'adresse soit connue ou non : on ne révèle pas qui a un compte.
        <Alerte ton="succes">Si un compte existe pour {email.trim()}, un e-mail vient de partir. Le lien est valable une heure.</Alerte>
      ) : (
        <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
          {erreur && <Alerte>{erreur}</Alerte>}
          <Champ id="email" libelle="Adresse e-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Bouton type="submit" occupe={occupe}>
            Recevoir le lien
          </Bouton>
        </form>
      )}
      <Link to="/connexion" className="text-center text-sm font-semibold text-marque underline-offset-4 hover:underline">
        Revenir à la connexion
      </Link>
    </PageAuth>
  );
}
