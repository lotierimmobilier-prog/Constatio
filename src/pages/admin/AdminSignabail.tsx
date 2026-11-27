import { useState } from 'react';
import { Alerte, Bouton, Carte } from '../../components/ui';
import { appel, instant } from '../../lib/admin';
import { useDonnee, useRoleAdmin } from './CoquilleAdmin';

interface Message { id: string; type: string; recu_le: string; traite_le: string | null; erreur: string | null; compte: string | null; bail: string | null; test: boolean; compte_lie: boolean }
const TYPES: Record<string, string> = { 'bail.genere': 'Bail généré', 'bail.signe': 'Bail signé', 'bail.annule': 'Bail annulé', 'offre_groupee.achetee': 'Offre groupée achetée', 'compte.supprime': 'Compte supprimé' };
const ERREURS: Record<string, string> = { ignore_test: 'Message de test reçu pour un compte réel : ignoré', type_inconnu: 'Type de message inconnu' };
const ISSUES: Record<string, string> = { traite: 'Message traité.', en_attente: 'Toujours en attente : le compte Signabail n’est relié à aucun compte Constatio.', sans_offre: 'Traité : ce bail ne donne pas droit à un état des lieux offert.', ignore_test: 'Ignoré : message de test pour un compte réel.', deja_traite: 'Ce message était déjà traité.' };

const ADRESSE_RECEPTION = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-signabail`;

/** Le secret partagé avec Signabail : tiré ici, montré une seule fois pour être recopié de l'autre côté. */
function Liaison() {
  const role = useRoleAdmin();
  const cles = useDonnee(() => (role === 'superadmin' ? appel<{ nom: string; fin: string; updated_at: string }[]>('admin_cles') : Promise.resolve([])));
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  if (role !== 'superadmin') return null;
  const connue = cles.donnee?.find((c) => c.nom === 'signabail_secret');
  const copier = async (quoi: string, valeur: string) => { try { await navigator.clipboard.writeText(valeur); setCopie(quoi); } catch { setCopie(null); } };
  async function generer() {
    const valeur = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(36)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      await appel('admin_definir_cle', { p_nom: 'signabail_secret', p_valeur: valeur });
      setSecret(valeur);
      setMessage({ ton: 'succes', texte: 'Secret enregistré. Copiez-le maintenant dans l’administration de Signabail : il ne sera plus affiché.' });
    } catch (e) { setMessage({ ton: 'erreur', texte: (e as Error).message }); }
    await cles.recharger();
  }
  return (
    <Carte>
      <h2 className="text-lg font-bold">Liaison avec Signabail</h2>
      <p className="max-w-[65ch] text-sm">Deux valeurs à recopier dans l’administration de Signabail (Réglages → Constatio) : l’adresse de réception et le secret partagé. Tant que le secret n’est pas le même des deux côtés, aucun bail n’arrive ici.</p>
      {message && <Alerte ton={message.ton}>{message.texte}</Alerte>}
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold">Adresse de réception de Constatio</p>
        <p className="break-all rounded-lg bg-creux px-2 py-1 font-mono text-xs" data-testid="adresse-reception">{ADRESSE_RECEPTION}</p>
        <button type="button" className="self-start font-semibold text-marque underline underline-offset-4" onClick={() => void copier('adresse', ADRESSE_RECEPTION)}>{copie === 'adresse' ? 'Adresse copiée' : 'Copier l’adresse'}</button>
      </div>
      <div className="flex flex-col gap-2 border-t border-trait pt-3 text-sm">
        <p className="font-semibold">Secret partagé</p>
        <p className="text-discret" data-testid="etat-secret">{connue ? `Enregistré le ${instant(connue.updated_at)} · se termine par ${connue.fin}` : 'Aucun secret : la liaison est coupée.'}</p>
        {secret && (
          <>
            <p className="break-all rounded-lg bg-creux px-2 py-1 font-mono text-xs" data-testid="secret-signabail">{secret}</p>
            <button type="button" className="self-start font-semibold text-marque underline underline-offset-4" onClick={() => void copier('secret', secret)}>{copie === 'secret' ? 'Secret copié' : 'Copier le secret'}</button>
          </>
        )}
        <Bouton variante="contour" className="sm:!w-auto sm:self-start sm:px-5" onClick={generer} data-testid="generer-secret">{connue ? 'Remplacer par un nouveau secret' : 'Créer le secret'}</Bouton>
        {connue && <p className="text-discret">Remplacer le secret coupe la liaison jusqu’à ce que le nouveau soit saisi dans Signabail.</p>}
      </div>
    </Carte>
  );
}

export function AdminSignabail() {
  const [tous, setTous] = useState(false);
  const { donnee: messages, erreur, recharger } = useDonnee(() => appel<Message[]>('admin_signabail', { p_seulement_a_traiter: !tous }), [tous]);
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  return (
    <>
      <h1 className="text-2xl font-bold">Messages reçus de Signabail</h1>
      <p className="max-w-[65ch] text-sm text-discret">Chaque bail d’habitation généré sur Signabail arrive ici, puis crée le crédit offert et le brouillon. Un message « en attente » est normal tant que le client ne s’est pas connecté à Constatio. Le contenu des baux n’est pas affiché.</p>
      <Liaison />
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
