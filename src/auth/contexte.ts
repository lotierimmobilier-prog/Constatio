import { createContext, useContext } from 'react';
import type { Etat } from './AuthProvider';

export const Contexte = createContext<Etat | null>(null);

export function useAuth(): Etat {
  const c = useContext(Contexte);
  if (!c) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return c;
}
