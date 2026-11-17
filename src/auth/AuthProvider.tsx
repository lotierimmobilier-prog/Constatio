import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type TypeCompte = 'particulier' | 'sci' | 'pro';
export type Role = 'proprietaire' | 'admin' | 'agent';

export interface Profil {
  id: string;
  prenom: string;
  nom: string;
  telephone: string | null;
}
export interface Organisation {
  id: string;
  type: TypeCompte;
  nom: string;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  carte_pro_numero: string | null;
  carte_pro_cci: string | null;
  est_test: boolean;
}

interface Etat {
  session: Session | null;
  /** Vrai tant que la session ou le compte ne sont pas chargés. */
  chargement: boolean;
  profil: Profil | null;
  organisation: Organisation | null;
  role: Role | null;
  recharger: () => Promise<void>;
  deconnecter: () => Promise<void>;
}

const Contexte = createContext<Etat | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);
  const [compte, setCompte] = useState<{ profil: Profil; organisation: Organisation; role: Role } | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPret(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const recharger = useCallback(async () => {
    if (!userId) {
      setCompte(null);
      return;
    }
    const [{ data: profil }, { data: membre }] = await Promise.all([
      supabase.from('profils').select('id, prenom, nom, telephone').eq('id', userId).single(),
      supabase
        .from('organisation_membres')
        .select('role, organisations(id, type, nom, siret, adresse, code_postal, ville, carte_pro_numero, carte_pro_cci, est_test)')
        .eq('user_id', userId)
        .order('created_at')
        .limit(1)
        .single(),
    ]);
    const organisation = membre?.organisations as unknown as Organisation | undefined;
    setCompte(profil && membre && organisation ? { profil, organisation, role: membre.role as Role } : null);
  }, [userId]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const valeur = useMemo<Etat>(
    () => ({
      session,
      chargement: !pret || (!!session && !compte),
      profil: compte?.profil ?? null,
      organisation: compte?.organisation ?? null,
      role: compte?.role ?? null,
      recharger,
      deconnecter: async () => {
        await supabase.auth.signOut();
        setCompte(null);
      },
    }),
    [session, pret, compte, recharger],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useAuth(): Etat {
  const c = useContext(Contexte);
  if (!c) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return c;
}
