import type { ReactNode } from 'react';
import { BandeauModeTest } from './BandeauModeTest';
import { Logo, PiedDePage } from './ui';

/** Gabarit des écrans de connexion : une colonne étroite, pensée pour le téléphone. */
export function PageAuth({ titre, intro, children }: { titre: string; intro?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <BandeauModeTest />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
        <Logo />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold leading-tight">{titre}</h1>
          {intro && <p className="text-discret">{intro}</p>}
        </div>
        {children}
      </main>
      <PiedDePage />
    </div>
  );
}
