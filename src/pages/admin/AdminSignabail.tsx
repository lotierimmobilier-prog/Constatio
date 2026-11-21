import { useState } from 'react';
import { Alerte } from '../../components/ui';
import { appel, instant } from '../../lib/admin';
import { useDonnee } from './CoquilleAdmin';

interface Message { id: string; type: string; recu_le: string; traite_le: string | null; erreur: string | null; compte: string | null; bail: string | null; test: boolean; compte_lie: boolean }
const TYPES: Record<string, string> = { 'bail.genere': 'Bail généré', 'bail.signe': 'Bail signé', 'bail.annule': 'Bail annulé', 'offre_groupee.achetee': 'Offre groupée achetée', 'compte.supprime': 'Compte supprimé' };
const ERREURS: Record<string, string> = { ignore_test: 'Message de test reçu pour un compte réel : ignoré', type_inconnu: 'Type de message inconnu' };
const ISSUES: Record<string, string> = { traite: 'Message traité.', en_attente: 'Toujours en attente : le compte Signabail n’est relié à aucun compte Constatio.', sans_offre: 'Traité : ce bail ne donne pas droit à un état des lieux offert.', ignore_test: 'Ignoré : message de test pour un compte réel.', deja_traite: 'Ce message était déjà traité.' };

export function AdminSignabail() {
  const [tous, setTous] = useState(false);
  const { donnee: messages, erreur, recharger } = useDonnee(() => appel<Message[]>('admin_signabail', { p_seulement_a_traiter: !tous }), [tous]);
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  return (
    <>
      <h1 className="text-2xl font-bold">Messages reçus de Signabail</h1>
      <p className="max-w-[65ch] text-sm text-discret">Chaque bail d’habitation généré sur Signabail arrive ici, puis crée le crédit offert et le brouillon. Un message « en attente » est normal tant que le client ne s’est pas connecté à Constatio. Le contenu des baux n’est pas affiché.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--marque))]" />Afficher aussi les messages déjà traités</label>
      {erreur && <Alerte>{erreur}</Alerte>}
      {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
      {messages && messages.length === 0 && <p className="text-discret">{tous ? 'Aucun message reçu pour l’instant.' : 'Rien à traiter.'}</p>}
      <ul className="flex flex-col gap-2">
        {messages?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-trait bg-surface p-4 text-sm">
            <span className="min-w-0">
              <span className="block font-semibold">{TYPES[m.type] ?? m.type}{m.test ? ' · test' : ''}</span>
              <span className="block text-discret">Reçu le {instant(m.recu_le)} · compte {m.compte ?? '—'}{m.bail ? ` · bail ${m.bail}` : ''}</span>
              <span className={`block font-semibold ${m.erreur ? 'text-hs' : m.traite_le ? 'text-neuf' : 'text-usage'}`}>
                {m.erreur ? (ERREURS[m.erreur] ?? m.erreur) : m.traite_le ? `Traité le ${instant(m.traite_le)}` : m.compte_lie ? 'En attente de traitement' : 'En attente : client pas encore inscrit'}
              </span>
            </span>
            {(!m.traite_le || m.erreur) && (
              <button className="font-semibold text-marque underline underline-offset-4" onClick={async () => {
                try { const issue = await appel<string>('admin_rejouer_signabail', { p_evenement: m.id }); setRetour({ ton: issue === 'traite' || issue === 'sans_offre' ? 'succes' : 'erreur', texte: ISSUES[issue] ?? issue }); }
                catch (e) { setRetour({ ton: 'erreur', texte: (e as Error).message }); }
                await recharger();
              }}>Retraiter</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
