import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { BandeauModeTest } from '../../components/BandeauModeTest';
import { Alerte, Logo } from '../../components/ui';
import { appel, type RoleAdmin } from '../../lib/admin';

const MENU: { vers: string; libelle: string; fin?: boolean; superSeul?: boolean }[] = [
  { vers: '/admin', libelle: 'Tableau de bord', fin: true },
  { vers: '/admin/comptes', libelle: 'Comptes' },
  { vers: '/admin/tarifs', libelle: 'Tarifs' },
  { vers: '/admin/signabail', libelle: 'Signabail' },
  { vers: '/admin/journal', libelle: 'Journal' },
  { vers: '/admin/reglages', libelle: 'Réglages', superSeul: true },
];

export const useRoleAdmin = () => useOutletContext<RoleAdmin>();

/** Cadre de l'administration. L'accès est décidé par la base : sans rôle, rien ne s'affiche et aucune donnée n'est servie. */
export function CoquilleAdmin() {
  const { session, chargement } = useAuth();
  const ici = useLocation();
  const [role, setRole] = useState<RoleAdmin | null | 'inconnu'>('inconnu');
  useEffect(() => {
    if (!session) return;
    appel<RoleAdmin | null>('admin_moi').then(setRole, () => setRole(null));
  }, [session]);

  if (chargement) return <p className="p-8 text-center text-discret">Chargement…</p>;
  if (!session) return <Navigate to="/connexion" replace state={{ retour: ici.pathname }} />;
  if (role === 'inconnu') return <p className="p-8 text-center text-discret">Chargement…</p>;
  if (!role)
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
        <Alerte>Cette partie du site est réservée aux administrateurs de Constatio.</Alerte>
        <Link to="/app" className="font-semibold text-marque underline underline-offset-4">Revenir à mon espace</Link>
      </main>
    );

  const lien = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-marque text-sur-marque' : 'text-encre hover:bg-creux'}`;
  return (
    <div className="flex min-h-full flex-col bg-fond">
      <BandeauModeTest />
      <header className="border-b border-trait bg-surface">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3"><Logo vers="/admin" /><span className="hidden text-sm text-discret sm:inline">Administration</span></div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-discret sm:inline">{session.user.email} · {role === 'superadmin' ? 'super administrateur' : 'administrateur'}</span>
            <Link to="/app" className="font-semibold text-marque underline underline-offset-4">Mon espace</Link>
          </div>
        </div>
      </header>
      <div className="lg:grid lg:flex-1 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Administration" className="flex gap-1 overflow-x-auto border-b border-trait bg-surface px-3 py-2 lg:flex-col lg:border-b-0 lg:border-r lg:py-5">
          {MENU.filter((m) => !m.superSeul || role === 'superadmin').map((m) => (
            <NavLink key={m.vers} to={m.vers} end={m.fin} className={lien}>{m.libelle}</NavLink>
          ))}
        </nav>
        <main className="flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-6"><Outlet context={role} /></main>
      </div>
    </div>
  );
}

/** Charge une donnée d'administration et gère l'attente et l'erreur de la même façon partout. */
export function useDonnee<T>(charger: () => Promise<T>, dependances: unknown[] = []) {
  const [donnee, setDonnee] = useState<T | null>(null);
  const [erreur, setErreur] = useState('');
  const recharger = () => charger().then((d) => { setDonnee(d); setErreur(''); }, (e: Error) => setErreur(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void recharger(); }, dependances);
  return { donnee, erreur, recharger };
}
