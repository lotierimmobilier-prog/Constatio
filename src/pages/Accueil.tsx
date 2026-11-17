import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BandeauModeTest } from '../components/BandeauModeTest';
import { Logo, PiedDePage, classesBouton } from '../components/ui';

// Page d'accueil provisoire : le site vitrine complet est la dernière étape du développement.
export function Accueil() {
  const { session } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <BandeauModeTest />
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-4">
        <Logo />
        <Link to={session ? '/app' : '/connexion'} className="text-sm font-semibold text-marque underline-offset-4 hover:underline">
          {session ? 'Mon espace' : 'Connexion'}
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6">
        <h1 className="text-4xl font-bold leading-tight">Un état des lieux incontestable en 20 minutes, depuis votre téléphone.</h1>
        <p className="text-lg text-discret">
          Pièce par pièce, photos horodatées, signature sur place. Conforme au décret du 30 mars 2016.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link to={session ? '/app' : '/inscription'} className={classesBouton('repere')}>
            Commencer gratuitement
          </Link>
          {!session && (
            <Link to="/connexion" className={classesBouton('contour')}>
              J’ai déjà un compte
            </Link>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-trait bg-trait">
          <div className="bg-surface p-4">
            <dt className="text-sm text-discret">État des lieux à l’unité</dt>
            <dd className="font-titre text-2xl font-bold tabular-nums">14,90 €</dd>
          </div>
          <div className="bg-surface p-4">
            <dt className="text-sm text-discret">Entrée + sortie</dt>
            <dd className="font-titre text-2xl font-bold tabular-nums">24,90 €</dd>
          </div>
        </dl>
        <p className="text-sm text-discret">Le brouillon est gratuit. Vous payez à la génération du document définitif.</p>
      </main>
      <PiedDePage />
    </div>
  );
}
