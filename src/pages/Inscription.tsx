import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth, type TypeCompte } from '../auth/AuthProvider';
import { PageAuth } from '../components/PageAuth';
import { Alerte, Bouton, Champ } from '../components/ui';
import { traduireErreur } from '../lib/erreurs';
import { supabase } from '../lib/supabase';
import { LONGUEUR_MOT_DE_PASSE, emailValide, motDePasseValide } from '../lib/validation';

const PROFILS: { valeur: TypeCompte; titre: string; detail: string }[] = [
  { valeur: 'particulier', titre: 'Particulier', detail: 'Je loue un ou plusieurs logements en mon nom.' },
  { valeur: 'sci', titre: 'SCI', detail: 'Les logements appartiennent à une société civile.' },
  { valeur: 'pro', titre: 'Professionnel', detail: 'Agence, gestionnaire ou conciergerie.' },
];

export function Inscription() {
  const { session } = useAuth();
  const aller = useNavigate();
  const [type, setType] = useState<TypeCompte>('particulier');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [accepte, setAccepte] = useState(false);
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState('');
  const [aConfirmer, setAConfirmer] = useState(false);
  const [occupe, setOccupe] = useState(false);

  if (session) return <Navigate to="/app" replace />;

  const err = {
    nom: nom.trim() ? '' : 'Indiquez votre nom.',
    email: emailValide(email) ? '' : 'Cette adresse e-mail n’est pas valide.',
    motDePasse: motDePasseValide(motDePasse) ? '' : `Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`,
    accepte: accepte ? '' : 'Vous devez accepter les conditions pour créer un compte.',
  };
  const valide = !Object.values(err).some(Boolean);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setTente(true);
    setErreur('');
    if (!valide) return;
    setOccupe(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: motDePasse,
      options: {
        data: { prenom: prenom.trim(), nom: nom.trim(), type_compte: type },
        emailRedirectTo: `${window.location.origin}/app`,
      },
    });
    setOccupe(false);
    if (error) setErreur(traduireErreur(error));
    else if (data.session) aller('/app', { replace: true });
    else setAConfirmer(true); // confirmation par e-mail activée
  }

  if (aConfirmer) {
    return (
      <PageAuth titre="Vérifiez votre boîte mail" intro={`Nous avons envoyé un lien de confirmation à ${email.trim()}.`}>
        <Alerte ton="info">Ouvrez ce lien pour activer votre compte. Pensez à regarder dans les indésirables.</Alerte>
        <Link to="/connexion" className="text-center text-sm font-semibold text-marque underline-offset-4 hover:underline">
          Revenir à la connexion
        </Link>
      </PageAuth>
    );
  }

  return (
    <PageAuth titre="Créer votre compte" intro="Gratuit et sans engagement. Vous ne payez qu’à la génération d’un état des lieux définitif.">
      <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
        {erreur && <Alerte>{erreur}</Alerte>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Vous êtes</legend>
          {PROFILS.map((p) => (
            <label
              key={p.valeur}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-surface p-3 ${type === p.valeur ? 'border-marque' : 'border-trait'}`}
            >
              <input type="radio" name="type" value={p.valeur} checked={type === p.valeur} onChange={() => setType(p.valeur)} className="mt-1 h-4 w-4 accent-[rgb(var(--marque))]" />
              <span>
                <span className="block font-semibold">{p.titre}</span>
                <span className="block text-sm text-discret">{p.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Champ id="prenom" libelle="Prénom" autoComplete="given-name" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          <Champ id="nom" libelle="Nom" autoComplete="family-name" required value={nom} onChange={(e) => setNom(e.target.value)} erreur={tente ? err.nom : ''} />
        </div>
        <Champ id="email" libelle="Adresse e-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} erreur={tente ? err.email : ''} />
        <Champ
          id="mot-de-passe"
          libelle="Mot de passe"
          type="password"
          autoComplete="new-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          aide={`Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`}
          erreur={tente ? err.motDePasse : ''}
        />
        <label className="flex items-start gap-3 text-sm">
          <input id="accepte" type="checkbox" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--marque))]" />
          <span>J’accepte les conditions générales de vente et la politique de confidentialité de Constatio.</span>
        </label>
        {tente && err.accepte && <p className="text-sm text-hs">{err.accepte}</p>}
        <Bouton type="submit" variante="repere" occupe={occupe}>
          Créer mon compte
        </Bouton>
      </form>
      <p className="text-center text-sm">
        Déjà inscrit ?{' '}
        <Link to="/connexion" className="font-semibold text-marque underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </PageAuth>
  );
}
