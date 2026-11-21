import { useState } from 'react';
import { Alerte, Bouton, Champ } from '../../components/ui';
import { appel, euros } from '../../lib/admin';
import { useDonnee } from './CoquilleAdmin';

interface Tarif { code: string; libelle: string; montant_cents: number; periodicite: 'unique' | 'mensuel'; credits: number; validite_mois: number; actif: boolean }

function LigneTarif({ tarif, onSauve }: { tarif: Tarif; onSauve: (message: { ton: 'succes' | 'erreur'; texte: string }) => void }) {
  const [libelle, setLibelle] = useState(tarif.libelle);
  const [prix, setPrix] = useState((tarif.montant_cents / 100).toFixed(2).replace('.', ','));
  const [credits, setCredits] = useState(String(tarif.credits));
  const [actif, setActif] = useState(tarif.actif);
  const [occupe, setOccupe] = useState(false);
  const centimes = Math.round(Number(prix.replace(/\s/g, '').replace(',', '.')) * 100);
  const change = libelle !== tarif.libelle || centimes !== tarif.montant_cents || Number(credits) !== tarif.credits || actif !== tarif.actif;

  async function sauver() {
    if (!Number.isFinite(centimes)) return onSauve({ ton: 'erreur', texte: 'Le prix doit être un nombre, par exemple 14,90.' });
    setOccupe(true);
    try {
      await appel('admin_modifier_tarif', { p_code: tarif.code, p_montant_cents: centimes, p_credits: Number(credits), p_actif: actif, p_libelle: libelle });
      onSauve({ ton: 'succes', texte: `« ${libelle} » enregistré : ${euros(centimes)}${tarif.periodicite === 'mensuel' ? ' par mois' : ''}.` });
    } catch (e) { onSauve({ ton: 'erreur', texte: (e as Error).message }); }
    setOccupe(false);
  }
  const k = tarif.code;
  return (
    <li className="grid items-end gap-3 rounded-2xl border border-trait bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto]" data-testid={`tarif-${k}`}>
      <Champ id={`libelle-${k}`} libelle="Libellé" value={libelle} onChange={(e) => setLibelle(e.target.value)} />
      <Champ id={`prix-${k}`} libelle={tarif.periodicite === 'mensuel' ? 'Prix TTC / mois' : 'Prix TTC'} inputMode="decimal" value={prix} onChange={(e) => setPrix(e.target.value)} />
      <Champ id={`credits-${k}`} libelle={tarif.periodicite === 'mensuel' ? 'Crédits / an' : 'Crédits'} inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value)} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--marque))]" />En vente</label>
        <Bouton className="!w-auto px-4" disabled={!change} occupe={occupe} onClick={sauver}>Enregistrer</Bouton>
      </div>
    </li>
  );
}

export function AdminTarifs() {
  const { donnee: tarifs, erreur, recharger } = useDonnee(() => appel<Tarif[]>('admin_tarifs'));
  const [message, setMessage] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  return (
    <>
      <h1 className="text-2xl font-bold">Tarifs</h1>
      <p className="max-w-[65ch] text-sm text-discret">Un changement s’applique aux prochains achats, sans redéploiement. Les crédits déjà achetés ne changent pas. Chaque modification est inscrite au journal, avec l’ancienne et la nouvelle valeur.</p>
      <Alerte ton="info">La page d’accueil et les guides affichent encore des prix écrits en dur : après un changement ici, il faut aussi les mettre à jour, tant qu’ils ne lisent pas cette table.</Alerte>
      {erreur && <Alerte>{erreur}</Alerte>}
      {message && <Alerte ton={message.ton}>{message.texte}</Alerte>}
      <ul className="flex flex-col gap-3">
        {tarifs?.map((t) => <LigneTarif key={`${t.code}-${t.montant_cents}-${t.credits}-${t.actif}-${t.libelle}`} tarif={t} onSauve={(m) => { setMessage(m); void recharger(); }} />)}
      </ul>
    </>
  );
}
