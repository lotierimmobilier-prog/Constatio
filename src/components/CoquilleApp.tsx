import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BandeauModeTest } from './BandeauModeTest';
import { BandeauSync } from './BandeauSync';
import { Logo } from './ui';

const ONGLETS = [
  { vers: '/app', libelle: 'États des lieux', fin: true },
  { vers: '/app/compte', libelle: 'Compte', fin: false },
];

/** Cadre des pages connectées : garde d'accès, en-tête, onglets en bas de l'écran. */
export function CoquilleApp() {
  const { session, chargement } = useAuth();
  const ici = useLocation();
  if (chargement) return <p className="p-8 text-center text-discret">Chargement…</p>;
  if (!session) return <Navigate to="/connexion" replace state={{ retour: ici.pathname }} />;
  return (
    <div className="flex min-h-full flex-col">
      <BandeauModeTest />
      <BandeauSync />
      <header className="border-b border-trait bg-surface px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <Logo vers="/app" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 pb-24">
        <Outlet />
      </main>
      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 border-t border-trait bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl">
          {ONGLETS.map((o) => (
            <NavLink
              key={o.vers}
              to={o.vers}
              end={o.fin}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-1 items-center justify-center text-sm font-semibold ${isActive ? 'text-marque' : 'text-discret'}`
              }
            >
              {o.libelle}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
