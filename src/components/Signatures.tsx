import { useCallback, useEffect, useState } from 'react';
import { Alerte, Bouton, Carte } from './ui';
import { PadSignature } from './PadSignature';
import { ROLES_PARTIE, type Partie } from '../lib/edl';
import { local } from '../lib/local';
import { demander, messageSignature, signaturesDe, type SignatureRecue } from '../lib/signature';
import { supabase } from '../lib/supabase';

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

  // Signature électronique par DocuSeal : 5 € par état des lieux, réglés avant l'envoi.
  const [suivi, setSuivi] = useState<{ statut: 'payee' | 'en_signature' | 'signee'; demande_id: string | null; demandee_le: string | null; liens: { partie_id: string; url: string }[] } | null>(null);
  const [prix, setPrix] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  async function payerElectronique() {
    setOccupe(true); setErreur(null);
    const { data, error } = await supabase.functions.invoke('paiement', { body: { action: 'commander_signature', edl_id: edlId } });
    let reponse = data as { statut: string; url?: string; motif?: string } | null;
    if (error) { try { reponse = await (error as { context?: Response }).context?.json(); } catch { reponse = null; } }
    if (reponse?.statut === 'ok' && reponse.url) { window.location.assign(reponse.url); return; }
    setOccupe(false);
    setErreur(reponse?.motif === 'ferme' ? 'Le paiement en ligne n’est pas encore ouvert.' : reponse?.motif === 'deja_paye' ? 'Cette signature est déjà réglée : rechargez la page.' : 'Le paiement n’a pas pu être préparé. Rien n’a été débité.');
  }
  async function electronique(action: 'electronique_envoyer' | 'electronique_relever') {
    setOccupe(true); setErreur(null); setInfo(null);
    const r = await demander({ action, edl_id: edlId });
    setOccupe(false);
    if (r.statut !== 'ok') return setErreur(r.motif === 'emails' ? 'Chaque signataire doit avoir une adresse e-mail, différente des autres.' : r.motif === 'ferme' ? 'La signature électronique n’est pas encore ouverte.' : messageSignature(r));
    if (r.retenue) setInfo('Mode test : la demande est enregistrée, mais rien n’est parti chez DocuSeal ni dans les boîtes des signataires.');
    else if (r.annulee) setInfo('La demande a été refusée ou a expiré chez DocuSeal. Vous pouvez la renvoyer, sans payer de nouveau.');
    else if (action === 'electronique_envoyer') setInfo('Envoyé : chaque signataire reçoit un e-mail de DocuSeal avec son lien.');
    else if (r.edl === 'en_signature') setInfo('Toutes les parties n’ont pas encore signé.');
    await charger();
    if (r.edl === 'signe') onSigne();
  }

  const charger = useCallback(async () => {
    setParties((await local.lister<Partie>('edl_parties', 'edl_id', edlId)).filter((p) => p.doit_signer !== false));
    setRecues(await signaturesDe(edlId));
    const [s, tarif] = await Promise.all([
      supabase.from('edl_signature_electronique').select('statut, demande_id, demandee_le, liens').eq('edl_id', edlId).maybeSingle(),
      supabase.from('tarifs').select('montant_cents').eq('code', 'signature_electronique').maybeSingle(),
    ]);
    setSuivi((s.data as typeof suivi) ?? null);
    setPrix(tarif.data?.montant_cents ?? null);
  }, [edlId]);
  useEffect(() => { void charger(); }, [charger]);
  // Au retour du paiement, le suivi apparaît dès que le message de Stripe est traité : on regarde à nouveau quelques fois.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('signature')) return;
    const minuteries = [2000, 5000, 10_000, 20_000].map((d) => setTimeout(() => void charger(), d));
    return () => minuteries.forEach(clearTimeout);
  }, [charger]);

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
  const adresses = parties.map((p) => (p.email ?? '').trim().toLowerCase());
  const sansEmail = parties.filter((_p, i) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresses[i]) || adresses.indexOf(adresses[i]) !== i);
  const electroniqueEnCours = !!suivi?.demande_id;

  return (
    <Carte>
      <h2 className="text-lg font-bold">Signatures</h2>
      <p className="text-sm text-discret" data-testid="reste-signatures">{reste === 0 ? 'Toutes les parties ont signé.' : `${reste} signature${reste > 1 ? 's' : ''} attendue${reste > 1 ? 's' : ''}. Chaque partie lit le document avant de signer.`}</p>
      {erreur && <Alerte>{erreur}</Alerte>}
      {info && <Alerte ton="info">{info}</Alerte>}
      {recues.length === 0 && prix !== null && (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-repere bg-surface p-3" data-testid="signature-electronique">
          <p className="font-semibold">Signature électronique DocuSeal — {(prix / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € par état des lieux</p>
          {!suivi && (
            <>
              <p className="text-sm text-discret">Chaque partie reçoit un e-mail et signe depuis son propre appareil ; DocuSeal certifie la signature et joint son certificat au document. Sinon, la signature à la main ci-dessous est comprise, horodatée.</p>
              {sansEmail.length > 0
                ? <p className="text-sm">Il manque l’adresse e-mail de {sansEmail.map(nomDe).join(', ')} (ou deux signataires ont la même). Rouvrez l’état des lieux pour la compléter dans « Parties ».</p>
                : <Bouton variante="contour" disabled={occupe} onClick={payerElectronique} data-testid="payer-electronique">Choisir la signature électronique</Bouton>}
            </>
          )}
          {suivi?.statut === 'payee' && (
            <>
              <p className="text-sm">Réglée. Il reste à envoyer le document aux signataires.</p>
              <Bouton disabled={occupe} onClick={() => electronique('electronique_envoyer')} data-testid="envoyer-electronique">{occupe ? 'Envoi…' : 'Envoyer aux signataires par e-mail'}</Bouton>
            </>
          )}
          {suivi?.statut === 'en_signature' && (
            <>
              <p className="text-sm" data-testid="electronique-en-cours">En cours de signature depuis le {suivi.demandee_le ? quand(suivi.demandee_le) : '—'}. L’état des lieux sera clos dès que tout le monde aura signé.</p>
              {suivi.liens.map((l) => { const p = parties.find((x) => x.id === l.partie_id); return p ? <a key={l.partie_id} href={l.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-marque underline underline-offset-4">Lien de signature de {nomDe(p)}</a> : null; })}
              <Bouton variante="contour" disabled={occupe} onClick={() => electronique('electronique_relever')} data-testid="relever-electronique">{occupe ? 'Vérification…' : 'Vérifier où en sont les signatures'}</Bouton>
            </>
          )}
        </div>
      )}
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
              {!s && enCours !== p.id && !electroniqueEnCours && (
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
