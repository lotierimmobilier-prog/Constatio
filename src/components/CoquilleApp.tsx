import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BandeauModeTest } from './BandeauModeTest';
import { BandeauSync } from './BandeauSync';
import { CLE_INVITATION } from '../pages/Rejoindre';
import { Logo } from './ui';

const ONGLETS = [
  { vers: '/app', libelle: 'États des lieux', fin: true },
  { vers: '/app/compte', libelle: 'Compte', fin: false },
];

/** Cadre des pages connectées : garde d'accès, en-tête, onglets en bas de l'écran. */
export function CoquilleApp() {
  const { session, chargement, estAdmin } = useAuth();
  const ici = useLocation();
  if (chargement) return <p className="p-8 text-center text-discret">Chargement…</p>;
  if (!session) return <Navigate to="/connexion" replace state={{ retour: ici.pathname }} />;
  // Une invitation d'agence attend : le compte tout juste créé (ou connecté) y est ramené pour la confirmer.
  let invitation: string | null = null;
  try { invitation = localStorage.getItem(CLE_INVITATION); } catch { invitation = null; }
  if (invitation) return <Navigate to={`/rejoindre/${invitation}`} replace />;
  const menu = [...ONGLETS.slice(0, 1), ...(estAdmin ? [{ vers: '/app/credits', libelle: 'Crédits et abonnement', fin: false }] : []), ...ONGLETS.slice(1)];
  return (
    <div className="flex min-h-full flex-col lg:pl-64">
      {/* Ordinateur : le menu tient dans une colonne à gauche, toujours visible. */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 border-r border-trait bg-surface px-5 py-6 lg:flex">
        <Logo vers="/app" />
        <NavLink to="/app/edl/nouveau" className="bouton inline-flex min-h-[48px] items-center justify-center rounded-xl bg-marque px-4 text-base font-semibold text-sur-marque hover:opacity-90">Nouvel état des lieux</NavLink>
        <nav aria-label="Navigation principale" className="flex flex-col gap-1">
          {menu.map((o) => (
            <NavLink key={o.vers} to={o.vers} end={o.fin}
              className={({ isActive }) => `flex min-h-[44px] items-center rounded-xl px-3 font-semibold ${isActive ? 'bg-creux text-marque' : 'text-discret hover:bg-fond hover:text-encre'}`}>
              {o.libelle}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto text-sm text-discret">Vos saisies s’enregistrent toutes seules, même sans réseau.</p>
      </aside>
      <BandeauModeTest />
      <BandeauSync />
      <header className="border-b border-trait bg-surface px-4 py-3 lg:hidden">
        <div className="mx-auto max-w-2xl">
          <Logo vers="/app" />
        </div>
      </header>
      <main className="ecran mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 pb-24 lg:max-w-5xl lg:px-8 lg:py-8">
        <Outlet />
      </main>
      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 border-t border-trait bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
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
