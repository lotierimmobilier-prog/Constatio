import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

const BASE_BOUTON =
  'inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const VARIANTES = {
  plein: 'bg-marque text-sur-marque hover:opacity-90',
  contour: 'border-2 border-marque text-marque hover:bg-creux',
  repere: 'bg-repere text-sur-repere hover:opacity-90',
} as const;

export function classesBouton(variante: keyof typeof VARIANTES = 'plein') {
  return `${BASE_BOUTON} ${VARIANTES[variante]}`;
}

export function Bouton({
  variante = 'plein',
  occupe,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: keyof typeof VARIANTES; occupe?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || occupe} className={`${classesBouton(variante)} ${props.className ?? ''}`}>
      {occupe ? 'Un instant…' : children}
    </button>
  );
}

const CHAMP =
  'min-h-[48px] w-full rounded-xl border border-trait bg-surface px-3 text-base text-encre placeholder:text-discret aria-[invalid=true]:border-hs';

export function Champ({
  libelle,
  aide,
  erreur,
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { libelle: string; id: string; aide?: string; erreur?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {libelle}
      </label>
      <input id={id} {...props} aria-invalid={!!erreur} aria-describedby={erreur || aide ? `${id}-aide` : undefined} className={`${CHAMP} ${className}`} />
      {(erreur || aide) && (
        <p id={`${id}-aide`} className={`text-sm ${erreur ? 'text-hs' : 'text-discret'}`}>
          {erreur ?? aide}
        </p>
      )}
    </div>
  );
}

export function Liste({
  libelle,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { libelle: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {libelle}
      </label>
      <select id={id} {...props} className={CHAMP}>
        {children}
      </select>
    </div>
  );
}

export function Alerte({ ton = 'erreur', children }: { ton?: 'erreur' | 'succes' | 'info'; children: ReactNode }) {
  const bord = { erreur: 'border-hs', succes: 'border-neuf', info: 'border-repere' }[ton];
  return (
    <div role={ton === 'erreur' ? 'alert' : 'status'} className={`rounded-r-lg border-l-4 ${bord} bg-surface px-3 py-2 text-sm`}>
      {children}
    </div>
  );
}

export function Carte({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-4 rounded-2xl border border-trait bg-surface p-4 ${className}`}>{children}</section>;
}

export function Logo({ vers = '/' }: { vers?: string }) {
  return (
    <Link to={vers} className="inline-flex items-center" aria-label="Constatio, accueil">
      <img src="/logo-constatio.webp" alt="Constatio" width={840} height={183} className="h-8 w-auto sm:h-9" />
    </Link>
  );
}

export function PiedDePage() {
  return <p className="py-6 text-center text-xs text-discret">Service partenaire de Signabail — conçu par LOTIER</p>;
}
