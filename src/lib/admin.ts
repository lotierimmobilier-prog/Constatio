// Appels aux fonctions d'administration. C'est la base qui vérifie le rôle à
// chaque appel ; ce fichier ne fait que traduire sa réponse.
import { supabase } from './supabase';

export type RoleAdmin = 'admin' | 'superadmin';

/** Les refus rédigés par la base (rôle, saisie invalide, introuvable) sont déjà en français et utiles à lire. */
export async function appel<T>(fonction: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fonction, params);
  if (!error) return data as T;
  throw new Error(['P0001', 'P0002', '42501'].includes(error.code) ? error.message : 'L’opération n’a pas abouti. Vérifiez votre connexion puis réessayez.');
}

export const euros = (centimes: number) => (centimes / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
export const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const instant = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const TYPES_COMPTE: Record<string, string> = { particulier: 'Particulier', sci: 'SCI', pro: 'Professionnel' };
export const ORIGINES: Record<string, string> = { achat: 'Achat', abonnement: 'Abonnement', signabail: 'Offert par Signabail', geste_commercial: 'Geste commercial' };
export const ACTIONS: Record<string, string> = {
  'admin.designe_par_le_serveur': 'Administrateur désigné au déploiement', 'admin.role': 'Rôle d’administration modifié',
  'credits.offerts': 'Crédits offerts', 'credits.retires': 'Crédits retirés', 'compte.test': 'Compte marqué test',
  'tarif.modifie': 'Tarif modifié', mode_test: 'Mode test', 'cle.enregistree': 'Clé de service enregistrée', 'cle.effacee': 'Clé de service effacée', 'signabail.rejoue': 'Message Signabail rejoué',
};
