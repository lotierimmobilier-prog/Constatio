import { useCallback, useEffect, useState } from 'react';
import { Alerte, Bouton, Carte } from './ui';
import { ROLES_PARTIE, type EdlLigne, type Logement, type Partie } from '../lib/edl';
import { local } from '../lib/local';
import { STATUTS_RESERVE, annexeReserves, creerLienReserves, instant, reservesDe, type Reserve } from '../lib/reserves';
import { supabase } from '../lib/supabase';

const nomDe = (p: Pick<Partie, 'civilite' | 'prenom' | 'nom'>) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');

/** Après la signature : le lien du document à remettre (ou renvoyer) à chaque partie, et, sur un état des lieux
 *  d'entrée, les réserves du locataire — pièce, constat, photos —, les réponses du bailleur et l'annexe. */
export function Reserves({ edl, logement, signeLe }: { edl: EdlLigne; logement: Logement; signeLe: string | null }) {
  const [parties, setParties] = useState<Partie[]>([]);
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [vignettes, setVignettes] = useState<Record<string, string>>({});
  const [reserves, setReserves] = useState<Reserve[] | null>(null);
  const [liens, setLiens] = useState<Record<string, { lien: string; limite: string | null; copie?: boolean }>>({});
  const [reponses, setReponses] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const limite = signeLe ? new Date(new Date(signeLe).getTime() + 10 * 86_400_000) : null;
  const entrant = edl.type === 'entrant';
  const ouvert = entrant && !!limite && limite.getTime() > Date.now();

  const charger = useCallback(async () => {
    setParties((await local.lister<Partie>('edl_parties', 'edl_id', edl.id)).sort((x, y) => x.ordre - y.ordre));
    setPieces(Object.fromEntries((await local.lister<{ id: string; nom: string }>('edl_pieces', 'edl_id', edl.id)).map((p) => [p.id, p.nom])));
    const lues = await reservesDe(edl.id);
    setReserves(lues);
    const chemins = (lues ?? []).flatMap((x) => x.photo_paths);
    if (chemins.length) {
      const { data } = await supabase.storage.from('edl').createSignedUrls(chemins, 900);
      setVignettes(Object.fromEntries((data ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl as string])));
    }
  }, [edl.id]);
  useEffect(() => { void charger(); }, [charger]);

  const auteur = (r: Reserve) => nomDe(parties.find((p) => p.id === r.partie_id) ?? { civilite: null, prenom: '', nom: 'Locataire' });
  async function lier(p: Partie) {
    setErreur(null);
    const r = await creerLienReserves(edl.id, p.id);
    if ('erreur' in r) return setErreur(r.erreur);
    setLiens((l) => ({ ...l, [p.id]: r }));
  }
  async function partager(p: Partie) {
    const l = liens[p.id];
    try {
      if (navigator.share) await navigator.share({ title: 'État des lieux signé', text: `Bonjour, voici le lien de l’état des lieux signé${(reserves?.length ?? 0) > 0 ? ' et de son annexe de réserves' : ''}.${l.limite ? ` Vous avez jusqu’au ${instant(l.limite)} pour y signaler ce qui manquerait à l’état des lieux d’entrée.` : ''} ${l.lien}` });
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
      titre: entrant ? 'État des lieux d’entrée' : 'État des lieux', adresse: `${logement.adresse}, ${logement.code_postal} ${logement.ville}`, signeLe, empreinte: edl.pdf_signe_sha256 ?? null,
      reserves: await Promise.all((reserves ?? []).map(async (r) => ({
        ...r, de: auteur(r), piece: r.piece_id ? pieces[r.piece_id] ?? null : null,
        photos: (await Promise.all(r.photo_paths.map(async (c) => { const f = await supabase.storage.from('edl').download(c); return f.data ? new Uint8Array(await f.data.arrayBuffer()) : null; }))).filter((o) => o !== null),
      }))),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    a.download = `annexe-reserves-${edl.date_edl.slice(0, 10)}.pdf`;
    a.click();
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">Remettre le document signé</h2>
      <p className="text-sm text-discret">Chaque partie reçoit son lien personnel, valable un an : elle y retrouve l’état des lieux signé{entrant ? ' et l’annexe des réserves' : ''}, sans créer de compte. Vous pouvez le renvoyer à tout moment ; un nouveau lien remplace le précédent.</p>
      {erreur && <Alerte>{erreur}</Alerte>}
      {parties.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3" data-testid="partie-lien">
          <p><span className="font-semibold">{nomDe(p)}</span> <span className="text-sm text-discret">· {ROLES_PARTIE[p.role] ?? p.role}</span></p>
          {liens[p.id] ? (
            <>
              <p className="text-sm">{liens[p.id].limite ? `Il peut y déposer ses réserves jusqu’au ${instant(liens[p.id].limite!)}.` : 'Lien de consultation du document signé.'}</p>
              <p className="break-all text-xs" data-testid="lien-reserves">{liens[p.id].lien}</p>
              <Bouton variante="contour" onClick={() => partager(p)}>{liens[p.id].copie ? 'Lien copié' : 'Partager le lien'}</Bouton>
            </>
          ) : <Bouton variante="contour" onClick={() => lier(p)} data-testid="creer-lien-reserves">{ouvert && p.role === 'locataire' ? 'Créer son lien (document et réserves)' : 'Créer son lien du document'}</Bouton>}
        </div>
      ))}
      {entrant && (
        <>
          <h2 className="text-lg font-bold">Réserves du locataire</h2>
          <p className="text-sm text-discret" data-testid="delai-reserves">
            {limite ? (ouvert ? `Le locataire peut demander à compléter l’état des lieux jusqu’au ${instant(limite.toISOString())} (dix jours).` : `Le délai de dix jours s’est achevé le ${instant(limite.toISOString())}.`) : ''}
          </p>
          {reserves === null ? <p className="text-sm">Les réserves s’affichent avec une connexion.</p> : reserves.length === 0 ? <p className="text-sm">Aucune réserve déposée.</p> : (
            <ul className="flex flex-col gap-3">
              {reserves.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3" data-testid="reserve">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm text-discret">{r.piece_id && pieces[r.piece_id] ? `${pieces[r.piece_id]} · ` : ''}{auteur(r)}, le {instant(r.created_at)}</span>
                    <span className={`whitespace-nowrap text-sm font-semibold ${r.statut === 'accepte' ? 'text-neuf' : r.statut === 'refuse' ? 'text-hs' : 'text-discret'}`}>{STATUTS_RESERVE[r.statut]}</span>
                  </div>
                  <p>{r.texte}</p>
                  {r.photo_paths.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {r.photo_paths.map((c, n) => vignettes[c]
                        ? <a key={c} href={vignettes[c]} target="_blank" rel="noreferrer"><img src={vignettes[c]} alt={`Photo ${n + 1} de la réserve${r.piece_id && pieces[r.piece_id] ? ` — ${pieces[r.piece_id]}` : ''}`} loading="lazy" className="aspect-square w-full rounded-xl object-cover" data-testid="photo-reserve" /></a>
                        : <span key={c} className="flex aspect-square items-center justify-center rounded-xl bg-creux text-xs text-discret">Photo {n + 1}</span>)}
                    </div>
                  )}
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
          <p className="text-sm text-discret">L’état des lieux signé ne change pas : les réserves, leurs photos et vos réponses forment une annexe, à joindre au document. Le lien de chaque partie la propose aussi.</p>
        </>
      )}
    </Carte>
  );
}
