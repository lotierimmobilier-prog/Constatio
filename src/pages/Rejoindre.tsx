import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { PageAuth } from '../components/PageAuth';
import { Alerte, Bouton, classesBouton } from '../components/ui';
import { supabase } from '../lib/supabase';

/** Clé sous laquelle l'invitation attend, le temps que la personne crée son compte ou se connecte. */
export const CLE_INVITATION = 'constatio.invitation';

/** Page ouverte par le lien d'invitation d'une agence : le collaborateur crée son identifiant, puis rejoint l'équipe. */
export function Rejoindre() {
  const { jeton } = useParams();
  const { session, recharger } = useAuth();
  const aller = useNavigate();
  const [invitation, setInvitation] = useState<{ agence: string; pour: string } | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    void supabase.rpc('equipe_invitation', { p_jeton: jeton }).then(({ data }) => {
      setInvitation((data as { agence: string; pour: string } | null) ?? null);
      // Gardée de côté : après l'inscription ou la connexion, l'application y ramène.
      try { if (data) localStorage.setItem(CLE_INVITATION, jeton!); else localStorage.removeItem(CLE_INVITATION); } catch { /* stockage refusé */ }
    });
  }, [jeton]);

  async function rejoindre() {
    setOccupe(true); setErreur(null);
    const { error } = await supabase.rpc('equipe_rejoindre', { p_jeton: jeton });
    setOccupe(false);
    if (error) return setErreur(error.code === 'P0001' || error.code === '42501' ? error.message : 'L’invitation n’a pas pu être prise en compte. Vérifiez votre connexion puis réessayez.');
    try { localStorage.removeItem(CLE_INVITATION); } catch { /* sans gravité */ }
    await recharger();
    aller('/app', { replace: true });
  }

  if (invitation === undefined) return <PageAuth titre="Invitation"><p className="text-discret">Chargement…</p></PageAuth>;
  if (invitation === null) return <PageAuth titre="Invitation expirée"><Alerte>Cette invitation n’est plus valable : elle a déjà servi, ou elle date de plus de sept jours. Demandez-en une nouvelle à votre administrateur.</Alerte></PageAuth>;
  return (
    <PageAuth titre={`Rejoindre ${invitation.agence}`} intro={`${invitation.pour}, vous êtes invité(e) à réaliser des états des lieux pour ${invitation.agence}.`}>
      {erreur && <Alerte>{erreur}</Alerte>}
      {session ? (
        <>
          <p className="text-sm">Vous êtes connecté(e) avec {session.user.email}. Ce compte rejoindra l’équipe.</p>
          <Bouton onClick={rejoindre} disabled={occupe} data-testid="rejoindre">{occupe ? 'Un instant…' : 'Rejoindre l’équipe'}</Bouton>
          <button type="button" className="text-sm font-semibold text-discret underline underline-offset-4" onClick={() => { try { localStorage.removeItem(CLE_INVITATION); } catch { /* sans gravité */ } aller('/app', { replace: true }); }}>Ne pas rejoindre, garder mon compte tel qu’il est</button>
        </>
      ) : (
        <>
          <p className="text-sm">Créez votre identifiant personnel ; vous reviendrez ici pour rejoindre l’équipe.</p>
          <Link to="/inscription" className={classesBouton('plein')}>Créer mon identifiant</Link>
          <Link to="/connexion" className={classesBouton('contour')}>J’ai déjà un identifiant</Link>
        </>
      )}
    </PageAuth>
  );
}
