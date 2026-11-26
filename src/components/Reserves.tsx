import { useCallback, useEffect, useState } from 'react';
import { Alerte, Bouton, Carte } from './ui';
import type { EdlLigne, Logement, Partie } from '../lib/edl';
import { local } from '../lib/local';
import { STATUTS_RESERVE, annexeReserves, creerLienReserves, instant, reservesDe, type Reserve } from '../lib/reserves';
import { supabase } from '../lib/supabase';

const nomDe = (p: Pick<Partie, 'civilite' | 'prenom' | 'nom'>) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');

/** Réserves du locataire sur un état des lieux d'entrée signé : lien à lui remettre, réponses du bailleur, annexe. */
export function Reserves({ edl, logement, signeLe }: { edl: EdlLigne; logement: Logement; signeLe: string | null }) {
  const [locataires, setLocataires] = useState<Partie[]>([]);
  const [reserves, setReserves] = useState<Reserve[] | null>(null);
  const [liens, setLiens] = useState<Record<string, { lien: string; limite: string; copie?: boolean }>>({});
  const [reponses, setReponses] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const limite = signeLe ? new Date(new Date(signeLe).getTime() + 10 * 86_400_000) : null;
  const ouvert = !!limite && limite.getTime() > Date.now();

  const charger = useCallback(async () => {
    setLocataires((await local.lister<Partie>('edl_parties', 'edl_id', edl.id)).filter((p) => p.role === 'locataire'));
    setReserves(await reservesDe(edl.id));
  }, [edl.id]);
  useEffect(() => { void charger(); }, [charger]);

  async function lier(p: Partie) {
    setErreur(null);
    const r = await creerLienReserves(edl.id, p.id);
    if ('erreur' in r) return setErreur(r.erreur);
    setLiens((l) => ({ ...l, [p.id]: r }));
  }
  async function partager(p: Partie) {
    const l = liens[p.id];
    try {
      if (navigator.share) await navigator.share({ title: 'Réserves sur l’état des lieux', text: `Bonjour, vous avez jusqu’au ${instant(l.limite)} pour signaler ce qui manquerait à l’état des lieux d’entrée : ${l.lien}` });
      else { await navigator.clipboard.writeText(l.lien); setLiens((x) => ({ ...x, [p.id]: { ...l, copie: true } })); }
    } catch { /* partage annulé */ }
  }
  async function repondre(r: Reserve, accepte: boolean) {
    setErreur(null);
    const { error } = await supabase.rpc('reserves_repondre', { p_reserve: r.id, p_accepte: accepte, p_reponse: reponses[r.id] ?? r.reponse ?? '' });
    if (error) setErreur(['P0001', '42501'].includes(error.code) ? error.message : 'La réponse n’a pas pu être enregistrée. Réessayez dans un instant.');
    await charger();
  }
  async function telecharger() {
    const pdf = await annexeReserves({
      titre: 'État des lieux d’entrée', adresse: `${logement.adresse}, ${logement.code_postal} ${logement.ville}`, signeLe, empreinte: edl.pdf_signe_sha256 ?? null,
      reserves: (reserves ?? []).map((r) => ({ ...r, de: nomDe(locataires.find((p) => p.id === r.partie_id) ?? { civilite: null, prenom: '', nom: 'Locataire' }) })),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    a.download = `annexe-reserves-${edl.date_edl.slice(0, 10)}.pdf`;
    a.click();
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">Réserves du locataire</h2>
      <p className="text-sm text-discret" data-testid="delai-reserves">
        {limite ? (ouvert ? `Le locataire peut demander à compléter l’état des lieux jusqu’au ${instant(limite.toISOString())} (dix jours).` : `Le délai de dix jours s’est achevé le ${instant(limite.toISOString())}.`) : ''}
      </p>
      {erreur && <Alerte>{erreur}</Alerte>}
      {ouvert && locataires.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3">
          <p className="font-semibold">{nomDe(p)}</p>
          {liens[p.id] ? (
            <>
              <p className="text-sm">Lien personnel, valable jusqu’au {instant(liens[p.id].limite)}. Il y dépose ses réserves, sans créer de compte.</p>
              <p className="break-all text-xs" data-testid="lien-reserves">{liens[p.id].lien}</p>
              <Bouton variante="contour" onClick={() => partager(p)}>{liens[p.id].copie ? 'Lien copié' : 'Partager le lien'}</Bouton>
            </>
          ) : <Bouton variante="contour" onClick={() => lier(p)} data-testid="creer-lien-reserves">Créer son lien de réserves</Bouton>}
        </div>
      ))}
      {reserves === null ? <p className="text-sm">Les réserves s’affichent avec une connexion.</p> : reserves.length === 0 ? <p className="text-sm">Aucune réserve déposée.</p> : (
        <ul className="flex flex-col gap-3">
          {reserves.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3" data-testid="reserve">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm text-discret">{nomDe(locataires.find((p) => p.id === r.partie_id) ?? { civilite: null, prenom: '', nom: 'Locataire' })}, le {instant(r.created_at)}</span>
                <span className={`whitespace-nowrap text-sm font-semibold ${r.statut === 'accepte' ? 'text-neuf' : r.statut === 'refuse' ? 'text-hs' : 'text-discret'}`}>{STATUTS_RESERVE[r.statut]}</span>
              </div>
              <p>{r.texte}</p>
              <label htmlFor={`reponse-${r.id}`} className="text-sm font-semibold">Votre réponse</label>
              <textarea id={`reponse-${r.id}`} rows={2} defaultValue={r.reponse ?? ''} onChange={(e) => setReponses((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="Constaté sur place le…" className="w-full rounded-xl border border-trait bg-surface px-3 py-2 text-base" />
              <div className="grid grid-cols-2 gap-3">
                <Bouton variante="contour" onClick={() => repondre(r, false)}>Refuser</Bouton>
                <Bouton onClick={() => repondre(r, true)}>Accepter</Bouton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {reserves !== null && reserves.length > 0 && <Bouton variante="contour" onClick={telecharger} data-testid="annexe-reserves">Télécharger l’annexe des réserves (PDF)</Bouton>}
      <p className="text-sm text-discret">L’état des lieux signé ne change pas : les réserves et vos réponses forment une annexe, à joindre au document.</p>
    </Carte>
  );
}
