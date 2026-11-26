import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { local } from '../lib/local';
import { supabase } from '../lib/supabase';

// Le compte est gardé sur l'appareil : l'application s'ouvre aussi sans réseau.
const CLE_COMPTE = 'constatio.compte';

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
  logo_path: string | null;
  filigrane_photos: boolean;
  filigrane_texte: string | null;
  filigrane_image_path: string | null;
  photos_colonnes: 2 | 3;
  couleur_documents: string | null;
}

export interface Droits { generer: boolean; voir_tous: boolean; supprimer: boolean }

export interface Etat {
  /** Vrai pour le titulaire et les administrateurs du compte : facturation, réglages, équipe. */
  estAdmin: boolean;
  session: Session | null;
  /** Vrai tant que la session ou le compte ne sont pas chargés. */
  chargement: boolean;
  profil: Profil | null;
  organisation: Organisation | null;
  role: Role | null;
  recharger: () => Promise<void>;
  deconnecter: () => Promise<void>;
}

// Le contexte vit à part (contexte.ts) : les pages publiques le lisent sans charger le stockage local de l'application.
export { Contexte, useAuth } from './contexte';
import { Contexte } from './contexte';

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
    // Un autre compte s'est servi de cet appareil : ses données locales ne doivent pas apparaître ici.
    const garde = JSON.parse(localStorage.getItem(CLE_COMPTE) ?? 'null') as { userId: string; compte: NonNullable<typeof compte> } | null;
    if (garde && garde.userId !== userId) {
      await local.effacerTout();
      localStorage.removeItem(CLE_COMPTE);
    } else if (garde) setCompte(garde.compte);
    const BASE = 'id, type, nom, siret, adresse, code_postal, ville, carte_pro_numero, carte_pro_cci, est_test';
    const lireMembre = (colonnes: string) =>
      supabase.from('organisation_membres').select(`role, droits, organisations(${colonnes})` as '*').eq('user_id', userId).order('created_at').limit(1).single() as unknown as Promise<{ data: { role: Role; droits?: Droits; organisations: unknown } | null; error: { message: string } | null }>;
    const [{ data: profil }, complet] = await Promise.all([
      supabase.from('profils').select('id, prenom, nom, telephone').eq('id', userId).single(),
      lireMembre(`${BASE}, logo_path, filigrane_photos, filigrane_texte, filigrane_image_path, photos_colonnes, couleur_documents`),
    ]);
    // Base pas encore à jour (réglages de présentation absents) : le compte s'ouvre quand même, sans eux.
    const tolere = async () => (await lireMembre(`${BASE}, logo_path, filigrane_photos, filigrane_texte`)).data ?? (await lireMembre(`${BASE}, logo_path`)).data ?? (await lireMembre(BASE)).data;
    const membre = complet.data ?? (complet.error && /column|colonne|schema/i.test(complet.error.message) ? await tolere() : null);
    const lue = membre?.organisations as unknown as Partial<Organisation> | undefined;
    const organisation = lue ? ({ logo_path: null, filigrane_photos: false, filigrane_texte: null, filigrane_image_path: null, photos_colonnes: 2, couleur_documents: null, ...lue } as Organisation) : undefined;
    if (profil && membre && organisation) {
      const suivant = { profil, organisation, role: membre.role as Role };
      localStorage.setItem(CLE_COMPTE, JSON.stringify({ userId, compte: suivant }));
      setCompte(suivant);
    }
    // Sinon (pas de réseau) : on garde le compte lu sur l'appareil.
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
      estAdmin: compte?.role === 'proprietaire' || compte?.role === 'admin',
      recharger,
      deconnecter: async () => {
        await local.effacerTout();
        localStorage.removeItem(CLE_COMPTE);
        await supabase.auth.signOut();
        setCompte(null);
      },
    }),
    [session, pret, compte, recharger],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

