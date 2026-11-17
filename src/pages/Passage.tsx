import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { PageAuth } from '../components/PageAuth';
import { Alerte, classesBouton } from '../components/ui';
import { supabase } from '../lib/supabase';

const CLE = 'constatio.rattachement';
type Etape = { nom: 'attente' } | { nom: 'confirmer'; email: string } | { nom: 'erreur'; texte: string };
const EXPIRE = 'Ce lien a expiré : il n’est valable qu’une minute. Revenez sur Signabail et cliquez à nouveau sur « Ouvrir dans Constatio ».';

/** Arrivée depuis Signabail : ouvre la session, ou demande de relier un compte Constatio existant. */
export function Passage() {
  const { session, chargement } = useAuth();
  const aller = useNavigate();
  const [etape, setEtape] = useState<Etape>({ nom: 'attente' });
  const fait = useRef(false);

  useEffect(() => {
    if (chargement || fait.current) return;
    const jeton = new URLSearchParams(window.location.hash.slice(1)).get('j');
    const garde = JSON.parse(sessionStorage.getItem(CLE) ?? 'null') as { attestation: string; email: string } | null;
    const arriver = (edl: string | null) => aller(edl ? `/app/edl/${edl}` : '/app', { replace: true });

    void (async () => {
      // Retour après connexion : on relie le compte Constatio de la personne à son compte Signabail.
      if (!jeton && garde && session) {
        fait.current = true;
        const { data, error } = await supabase.functions.invoke('passage-signabail', { body: { attestation: garde.attestation } });
        sessionStorage.removeItem(CLE);
        if (error || data?.statut !== 'rattache') {
          const texte = data?.motif === 'autre_compte'
            ? `Vous êtes connecté avec une autre adresse que ${garde.email}. Déconnectez-vous, puis reconnectez-vous avec cette adresse.`
            : data?.motif === 'perime' ? 'Le délai pour relier vos comptes est dépassé. Revenez sur Signabail et recommencez.' : 'Vos comptes n’ont pas pu être reliés. Réessayez depuis Signabail.';
          return setEtape({ nom: 'erreur', texte });
        }
        return arriver(data.edl);
      }
      if (!jeton) return garde ? setEtape({ nom: 'confirmer', email: garde.email }) : setEtape({ nom: 'erreur', texte: 'Ce lien est incomplet. Revenez sur Signabail et cliquez sur « Ouvrir dans Constatio ».' });

      fait.current = true;
      history.replaceState(null, '', '/passage'); // le jeton ne reste pas dans l'adresse
      const { data, error } = await supabase.functions.invoke('passage-signabail', { body: { jeton } });
      if (error) return setEtape({ nom: 'erreur', texte: 'Connexion impossible pour l’instant. Réessayez depuis Signabail dans un instant.' });
      if (data.statut === 'session') {
        const ouverture = await supabase.auth.verifyOtp({ type: 'email', token_hash: data.session });
        if (ouverture.error) return setEtape({ nom: 'erreur', texte: EXPIRE });
        return arriver(data.edl);
      }
      if (data.statut === 'confirmer') {
        sessionStorage.setItem(CLE, JSON.stringify({ attestation: data.attestation, email: data.email }));
        return setEtape({ nom: 'confirmer', email: data.email });
      }
      setEtape({ nom: 'erreur', texte: data.motif === 'perime' ? EXPIRE : 'Ce lien n’est pas valable. Revenez sur Signabail et cliquez sur « Ouvrir dans Constatio ».' });
    })();
  }, [chargement, session, aller]);

  if (etape.nom === 'attente') return <PageAuth titre="Un instant…" intro="Nous ouvrons votre espace Constatio depuis Signabail."><span /></PageAuth>;
  if (etape.nom === 'confirmer')
    return (
      <PageAuth titre="Reliez vos deux comptes" intro={`Un compte Constatio existe déjà avec l’adresse ${etape.email}.`}>
        <Alerte ton="info">Pour votre sécurité, connectez-vous une fois à Constatio : vos comptes Signabail et Constatio seront alors reliés, et vous n’aurez plus à le refaire. Vous avez un quart d’heure.</Alerte>
        <Link to="/connexion" state={{ retour: '/passage' }} className={classesBouton('plein')}>Me connecter à Constatio</Link>
      </PageAuth>
    );
  return (
    <PageAuth titre="Lien non valable">
      <Alerte>{etape.texte}</Alerte>
      <a href="https://signabail.fr/espace" className={classesBouton('contour')}>Revenir sur Signabail</a>
    </PageAuth>
  );
}
