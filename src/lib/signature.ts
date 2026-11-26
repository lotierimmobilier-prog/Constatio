// Signature électronique, vue de l'application. Tout se décide côté serveur
// (fonction « signature ») : ici, on demande et on traduit la réponse.
import { supabase } from './supabase';

export interface ReponseSignature { statut: 'ok' | 'refuse' | 'reseau'; motif?: string; [cle: string]: unknown }

export async function demander(corps: Record<string, unknown>): Promise<ReponseSignature> {
  const { data, error } = await supabase.functions.invoke('signature', { body: corps });
  if (!error) return data as ReponseSignature;
  const contexte = (error as { context?: Response }).context;
  if (!contexte || typeof contexte.json !== 'function') return { statut: 'reseau' };
  try { const r = await contexte.json(); return r?.statut === 'refuse' ? r : { statut: 'refuse', motif: 'erreur' }; } catch { return { statut: 'refuse', motif: 'erreur' }; }
}

export const MOTIFS: Record<string, string> = {
  deja_signe: 'Cette personne a déjà signé.',
  lien: 'Ce lien de signature n’est plus valable. Demandez-en un nouveau à la personne qui a réalisé l’état des lieux.',
  document: 'Le document a changé depuis : rechargez la page.',
  signe: 'Cet état des lieux est déjà signé par toutes les parties.',
  session: 'Votre session a expiré : reconnectez-vous.',
  image: 'La signature n’a pas pu être lue : recommencez le tracé.',
  lecture: 'Confirmez d’abord avoir lu le document.',
  electronique_en_cours: 'Une signature électronique est en cours pour ce document : on ne peut plus signer à la main.',
  non_payee: 'La signature électronique de cet état des lieux n’est pas réglée.',
  deja_envoyee: 'La demande a déjà été envoyée aux signataires.',
};
export const messageSignature = (r: ReponseSignature) =>
  r.statut === 'reseau' ? 'Pas de réseau : la signature a besoin d’une connexion. Rien n’est perdu, réessayez dans un instant.' : MOTIFS[r.motif ?? ''] ?? 'La signature n’a pas pu être enregistrée. Réessayez dans un instant.';

export interface SignatureRecue { partie_id: string; signe_le: string; mode: 'sur_place' | 'a_distance' }
export async function signaturesDe(edlId: string): Promise<SignatureRecue[] | null> {
  const { data, error } = await supabase.from('edl_signatures').select('partie_id, signe_le, mode').eq('edl_id', edlId);
  return error ? null : (data as SignatureRecue[]);
}
