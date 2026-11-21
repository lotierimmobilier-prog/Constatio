import { useCallback, useEffect, useState } from 'react';
import { Alerte, Bouton, Carte } from './ui';
import { PadSignature } from './PadSignature';
import { ROLES_PARTIE, type Partie } from '../lib/edl';
import { local } from '../lib/local';
import { demander, messageSignature, signaturesDe, type SignatureRecue } from '../lib/signature';

const quand = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const nomDe = (p: Pick<Partie, 'civilite' | 'prenom' | 'nom'>) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');

/** Recueil des signatures d'un état des lieux terminé : sur cet appareil, ou par lien personnel. */
export function Signatures({ edlId, documentAdresse, onSigne }: { edlId: string; documentAdresse: string | null; onSigne: () => void }) {
  const [parties, setParties] = useState<Partie[]>([]);
  const [recues, setRecues] = useState<SignatureRecue[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [lu, setLu] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [liens, setLiens] = useState<Record<string, { lien: string; expire_le: string; copie?: boolean }>>({});

  const charger = useCallback(async () => {
    setParties((await local.lister<Partie>('edl_parties', 'edl_id', edlId)).filter((p) => p.doit_signer !== false));
    setRecues(await signaturesDe(edlId));
  }, [edlId]);
  useEffect(() => { void charger(); }, [charger]);

  async function signer(partie: Partie, image: string) {
    setOccupe(true); setErreur(null);
    const r = await demander({ action: 'signer', edl_id: edlId, partie_id: partie.id, image, lu: true });
    setOccupe(false);
    if (r.statut !== 'ok') return setErreur(messageSignature(r));
    setEnCours(null); setLu(false);
    await charger();
    if (r.edl === 'signe') onSigne();
  }
  async function creerLien(partie: Partie) {
    setErreur(null);
    const r = await demander({ action: 'lien', edl_id: edlId, partie_id: partie.id });
    if (r.statut !== 'ok') return setErreur(messageSignature(r));
    setLiens((l) => ({ ...l, [partie.id]: { lien: r.lien as string, expire_le: r.expire_le as string } }));
  }
  async function partager(partie: Partie) {
    const l = liens[partie.id];
    const texte = `Bonjour, voici le lien pour lire et signer l’état des lieux : ${l.lien}`;
    try {
      if (navigator.share) await navigator.share({ title: 'État des lieux à signer', text: texte });
      else { await navigator.clipboard.writeText(l.lien); setLiens((x) => ({ ...x, [partie.id]: { ...l, copie: true } })); }
    } catch { /* partage annulé */ }
  }
  async function finir() {
    setOccupe(true); setErreur(null);
    const r = await demander({ action: 'cloturer', edl_id: edlId });
    setOccupe(false);
    if (r.statut !== 'ok') return setErreur(messageSignature(r));
    if (r.edl === 'signe') onSigne();
  }

  if (recues === null) return <Carte><h2 className="text-lg font-bold">Signatures</h2><p className="text-sm">Les signatures se recueillent avec une connexion. Elles s’afficheront dès que le réseau revient.</p></Carte>;
  const signee = (p: Partie) => recues.find((s) => s.partie_id === p.id);
  const reste = parties.filter((p) => !signee(p)).length;

  return (
    <Carte>
      <h2 className="text-lg font-bold">Signatures</h2>
      <p className="text-sm text-discret" data-testid="reste-signatures">{reste === 0 ? 'Toutes les parties ont signé.' : `${reste} signature${reste > 1 ? 's' : ''} attendue${reste > 1 ? 's' : ''}. Chaque partie lit le document avant de signer.`}</p>
      {erreur && <Alerte>{erreur}</Alerte>}
      <ul className="flex flex-col gap-3">
        {parties.map((p) => {
          const s = signee(p);
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3" data-testid={`signataire-${p.role}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0"><span className="block text-sm text-discret">{ROLES_PARTIE[p.role]}</span><span className="block font-semibold">{nomDe(p)}</span></span>
                <span className={`whitespace-nowrap text-sm font-semibold ${s ? 'text-neuf' : 'text-discret'}`}>{s ? 'Signé' : 'À signer'}</span>
              </div>
              {s && <p className="text-sm text-discret">Le {quand(s.signe_le)}, {s.mode === 'sur_place' ? 'sur place' : 'à distance'}.</p>}
              {!s && enCours === p.id && (
                <>
                  {documentAdresse && <a href={documentAdresse} target="_blank" rel="noreferrer" className="text-sm font-semibold text-marque underline underline-offset-4">Lire le document avant de signer</a>}
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={lu} onChange={(e) => setLu(e.target.checked)} />
                    <span>Je soussigné(e) {nomDe(p)} ai lu l’état des lieux et l’approuve.</span>
                  </label>
                  {lu && <PadSignature occupe={occupe} onValider={(png) => signer(p, png)} onAnnuler={() => { setEnCours(null); setLu(false); }} />}
                  {!lu && <Bouton variante="contour" onClick={() => setEnCours(null)}>Annuler</Bouton>}
                </>
              )}
              {!s && enCours !== p.id && (
                <div className="grid grid-cols-2 gap-3">
                  <Bouton onClick={() => { setEnCours(p.id); setLu(false); setErreur(null); }} data-testid="signer-ici">Signer ici</Bouton>
                  <Bouton variante="contour" onClick={() => creerLien(p)} data-testid="creer-lien">{liens[p.id] ? 'Nouveau lien' : 'Signer à distance'}</Bouton>
                </div>
              )}
              {!s && liens[p.id] && (
                <div className="flex flex-col gap-2 rounded-lg bg-creux p-2">
                  <p className="text-sm">Lien personnel, valable jusqu’au {quand(liens[p.id].expire_le)}. Transmettez-le uniquement à {nomDe(p)} : quiconque le détient peut signer à sa place.</p>
                  <p className="break-all text-xs" data-testid="lien-signature">{liens[p.id].lien}</p>
                  <Bouton variante="contour" onClick={() => partager(p)}>{liens[p.id].copie ? 'Lien copié' : 'Partager le lien'}</Bouton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {reste === 0 && parties.length > 0 && (
        <>
          <p className="text-sm">Les signatures sont enregistrées, mais l’exemplaire signé n’a pas encore été produit.</p>
          <Bouton disabled={occupe} onClick={finir} data-testid="finir-signatures">{occupe ? 'Production en cours…' : 'Produire l’exemplaire signé'}</Bouton>
        </>
      )}
    </Carte>
  );
}
