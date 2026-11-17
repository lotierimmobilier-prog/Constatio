// Le magasin local branché sur Supabase, et son état pour l'affichage.
import { useEffect, useSyncExternalStore } from 'react';
import { Magasin, TABLES_ENFANTS, type ContenuEdl, type Ligne, type Mutation, type Reponse, type Transport } from './magasin';
import { supabase } from './supabase';

interface Erreur { message: string; code?: string }

/** Défaut de réseau ou serveur indisponible : on réessaiera, rien n'est refusé. */
const estPassager = (e: Erreur | null, status: number) =>
  !navigator.onLine || status === 0 || status === 401 || status >= 500 || (!!e && /fetch|network|load failed|timeout/i.test(e.message));

/** Les refus prononcés par la base sont déjà rédigés en français (verrou après signature…). */
const motif = (e: Erreur) => (e.code === 'P0001' ? e.message : 'refusé par le serveur');

const transport: Transport = {
  async envoyer(m: Mutation): Promise<Reponse> {
    const t = supabase.from(m.table);
    if (m.op === 'insert') {
      const { error, status } = await t.insert(m.donnees!);
      if (!error || error.code === '23505') return 'ok'; // déjà reçue lors d'un envoi précédent
      return estPassager(error, status) ? 'reseau' : { rejet: motif(error) };
    }
    if (m.op === 'upsert') {
      const { error, status } = await t.upsert(m.donnees!, { onConflict: m.conflit });
      if (!error) return 'ok';
      return estPassager(error, status) ? 'reseau' : { rejet: motif(error) };
    }
    if (m.op === 'update') {
      const { data, error, status } = await t.update(m.donnees!).eq('id', m.id).select('id');
      if (error) return estPassager(error, status) ? 'reseau' : { rejet: motif(error) };
      // Aucune ligne touchée : les règles d'accès ont refusé, ou la ligne n'existe plus.
      return data.length ? 'ok' : { rejet: 'modification impossible (élément supprimé ou état des lieux verrouillé)' };
    }
    const { error, status } = await t.delete().eq('id', m.id);
    if (!error) return 'ok';
    return estPassager(error, status) ? 'reseau' : { rejet: motif(error) };
  },

  async tirerEdl(edlId) {
    const tete = await supabase.from('edl').select('*').eq('id', edlId).maybeSingle();
    if (tete.error) return 'reseau';
    if (!tete.data) return null;
    const [logement, ...enfants] = await Promise.all([
      supabase.from('logements').select('*').eq('id', tete.data.logement_id),
      ...TABLES_ENFANTS.map((t) => supabase.from(t).select('*').eq('edl_id', edlId)),
    ]);
    if (logement.error || enfants.some((r) => r.error)) return 'reseau';
    const contenu = { edl: [tete.data], logements: logement.data } as unknown as ContenuEdl;
    TABLES_ENFANTS.forEach((t, i) => (contenu[t] = enfants[i].data as Ligne[]));
    return contenu;
  },

  async tirerListe(organisationId) {
    const [edl, logements] = await Promise.all([
      supabase.from('edl').select('*').eq('organisation_id', organisationId),
      supabase.from('logements').select('*').eq('organisation_id', organisationId),
    ]);
    if (edl.error || logements.error) return 'reseau';
    return { edl: edl.data as Ligne[], logements: logements.data as Ligne[] };
  },
};

export const local = new Magasin('constatio', transport);

// La file repart dès que le réseau revient, puis régulièrement tant qu'elle n'est pas vide.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void local.synchroniser());
  setInterval(() => {
    if (navigator.onLine && local.lireEtat().enAttente) void local.synchroniser();
  }, 15_000);
}

const abonnerReseau = (f: () => void) => {
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
};

/** Ce que l'indicateur affiche : réseau, envois en attente, refus à lire. */
export function useSync() {
  const etat = useSyncExternalStore(local.abonner, local.lireEtat);
  const enLigne = useSyncExternalStore(abonnerReseau, () => navigator.onLine);
  useEffect(() => {
    if (enLigne) void local.synchroniser();
  }, [enLigne]);
  return { ...etat, enLigne };
}
