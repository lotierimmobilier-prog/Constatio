import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Logo, classesBouton } from '../components/ui';
import { compresser } from '../lib/photos';
import { STATUTS_RESERVE, annexeReserves, instant } from '../lib/reserves';
import { supabase } from '../lib/supabase';

interface ReserveLue { texte: string; statut: 'demande' | 'accepte' | 'refuse'; reponse: string | null; depose_le: string; repondu_le: string | null; piece: string | null; photos: string[]; de: string | null }
interface Dossier {
  adresse: string; type: string; date_edl: string; signe_le: string | null; empreinte: string | null; limite: string | null; ouvert: boolean;
  role: string; locataire: string; dossier: string; pieces: { id: string; nom: string }[]; reserves: ReserveLue[];
}
const TITRES: Record<string, string> = { entrant: 'État des lieux d’entrée', sortant: 'État des lieux de sortie' };
const PHOTOS_MAX = 6;
const complet = (relatif: string) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1${relatif}`;

/** Page ouverte par le lien du document : chaque partie y retrouve l'état des lieux signé et les réserves ;
 *  le locataire y signale, sans compte et pendant dix jours, ce qui manque à l'état des lieux d'entrée. */
export function Reserves() {
  const { jeton } = useParams();
  const [dossier, setDossier] = useState<Dossier | null | undefined>(undefined);
  const [fichiers, setFichiers] = useState<{ document: string | null; photos: Record<string, string> }>({ document: null, photos: {} });
  const [texte, setTexte] = useState('');
  const [piece, setPiece] = useState('');
  const [photos, setPhotos] = useState<{ cle: string; contenu: Blob; apercu: string }[]>([]);
  const [retour, setRetour] = useState<{ ton: 'erreur' | 'succes'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const charger = useCallback(async () => {
    setDossier(((await supabase.rpc('reserves_consulter', { p_jeton: jeton })).data as Dossier | null) ?? null);
    // Les adresses des fichiers ne durent qu'un quart d'heure : la page reste lisible sans elles.
    const { data } = await supabase.functions.invoke('signature', { body: { action: 'dossier', jeton } }).catch(() => ({ data: null }));
    if (data?.statut === 'ok') setFichiers({ document: data.document ?? null, photos: data.photos ?? {} });
  }, [jeton]);
  useEffect(() => { void charger(); }, [charger]);

  async function ajouter(liste: FileList | null) {
    setRetour(null);
    const ajoutees: typeof photos = [];
    for (const f of [...(liste ?? [])].slice(0, PHOTOS_MAX - photos.length)) {
      try { const { contenu } = await compresser(f); ajoutees.push({ cle: crypto.randomUUID(), contenu, apercu: URL.createObjectURL(contenu) }); }
      catch { setRetour({ ton: 'erreur', texte: 'Une image n’a pas pu être lue. Choisissez une photo au format JPEG ou PNG.' }); }
    }
    setPhotos((p) => [...p, ...ajoutees]);
  }

  async function deposer(e: FormEvent) {
    e.preventDefault();
    if (!dossier) return;
    setOccupe(true); setRetour(null);
    const chemins: string[] = [];
    for (const p of photos) {
      const chemin = `${dossier.dossier}/${p.cle}.jpg`;
      const { error } = await supabase.storage.from('edl').upload(chemin, p.contenu, { contentType: 'image/jpeg' });
      // Déjà envoyée lors d'un premier essai : on la garde.
      if (error && !/exist/i.test(error.message)) { setOccupe(false); return setRetour({ ton: 'erreur', texte: 'Une photo n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez.' }); }
      chemins.push(chemin);
    }
    const { error } = await supabase.rpc('reserves_deposer', { p_jeton: jeton, p_texte: texte, p_piece: piece || null, p_photos: chemins });
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: error.code === 'P0001' ? error.message : 'Votre réserve n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.' });
    setTexte(''); setPiece(''); setPhotos([]);
    setRetour({ ton: 'succes', texte: 'Réserve enregistrée. Votre bailleur la retrouve dans son espace ; sa réponse apparaîtra ici.' });
    await charger();
  }

  async function annexe() {
    if (!dossier) return;
    setOccupe(true);
    const octets = async (chemin: string) => { const a = fichiers.photos[chemin]; if (!a) return null; try { const r = await fetch(complet(a)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
    const pdf = await annexeReserves({
      titre: TITRES[dossier.type] ?? 'État des lieux', adresse: dossier.adresse, signeLe: dossier.signe_le, empreinte: dossier.empreinte,
      reserves: await Promise.all(dossier.reserves.map(async (r) => ({ de: r.de ?? 'Locataire', piece: r.piece, texte: r.texte, statut: r.statut, reponse: r.reponse, created_at: r.depose_le, repondu_le: r.repondu_le, photos: (await Promise.all(r.photos.map(octets))).filter((o) => o !== null) }))),
    });
    setOccupe(false);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    a.download = `annexe-reserves-${dossier.date_edl.slice(0, 10)}.pdf`;
    a.click();
  }

  const locataireEntrant = dossier?.role === 'locataire' && dossier.type === 'entrant';
  return (
    <div className="min-h-dvh bg-fond">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <Logo />
        {dossier === undefined && <p className="text-center text-discret">Chargement…</p>}
        {dossier === null && <Alerte>Ce lien n’est pas valable. Demandez-en un nouveau à la personne qui a réalisé l’état des lieux.</Alerte>}
        {dossier && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{dossier.ouvert ? 'Compléter l’état des lieux' : 'Votre état des lieux signé'}</h1>
              <p className="text-sm text-discret">{dossier.adresse} · {(TITRES[dossier.type] ?? 'État des lieux').toLowerCase()} du {new Date(dossier.date_edl).toLocaleDateString('fr-FR')}</p>
            </div>
            <Carte>
              <p className="font-semibold" data-testid="locataire">{dossier.locataire}</p>
              {dossier.signe_le && <p className="text-sm">Document signé le {instant(dossier.signe_le)}. Conservez-le pendant toute la durée de la location.</p>}
              {fichiers.document
                ? <a href={complet(fichiers.document)} target="_blank" rel="noreferrer" className={classesBouton('repere')} data-testid="document-signe">Ouvrir l’état des lieux signé</a>
                : <p className="text-sm text-discret">Le document s’ouvre avec une connexion. Rechargez la page s’il n’apparaît pas.</p>}
              {dossier.reserves.length > 0 && <Bouton variante="contour" onClick={annexe} disabled={occupe} data-testid="annexe-reserves">Télécharger l’annexe des réserves (PDF)</Bouton>}
              {dossier.empreinte && <p className="break-all text-xs text-discret">Empreinte du document signé (SHA-256) : {dossier.empreinte}</p>}
            </Carte>
            {locataireEntrant && (
              <Carte>
                <h2 className="font-bold">Signaler une réserve</h2>
                <p className="text-sm">Vous avez dix jours pour signaler ce que l’état des lieux d’entrée n’a pas relevé (loi du 6 juillet 1989, article 3-2). {dossier.limite ? (dossier.ouvert ? `Jusqu’au ${instant(dossier.limite)}.` : `Ce délai s’est achevé le ${instant(dossier.limite)}.`) : ''}</p>
                {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
                {dossier.ouvert && (
                  <form onSubmit={deposer} className="flex flex-col gap-3" noValidate>
                    <label htmlFor="piece" className="font-semibold">Pièce concernée</label>
                    <select id="piece" value={piece} onChange={(e) => setPiece(e.target.value)} className="w-full rounded-xl border border-trait bg-surface px-3 py-3 text-base">
                      <option value="">Tout le logement, ou autre</option>
                      {dossier.pieces.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                    </select>
                    <label htmlFor="reserve" className="font-semibold">Votre réserve</label>
                    <textarea id="reserve" rows={4} value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={2000} placeholder="Élément concerné, ce que vous constatez…" className="w-full rounded-xl border border-trait bg-surface px-3 py-2 text-base" />
                    <p className="text-sm text-discret">Une réserve par constat. Soyez précis : élément, emplacement, défaut.</p>
                    {photos.length > 0 && (
                      <ul className="grid grid-cols-3 gap-2">
                        {photos.map((p, i) => (
                          <li key={p.cle} className="relative" data-testid="photo-reserve">
                            <img src={p.apercu} alt={`Photo ${i + 1} jointe à la réserve`} className="aspect-square w-full rounded-xl object-cover" />
                            <button type="button" onClick={() => setPhotos((l) => l.filter((x) => x.cle !== p.cle))} aria-label={`Retirer la photo ${i + 1}`} className="absolute right-1 top-1 h-8 w-8 rounded-full bg-encre/80 text-lg font-bold text-surface">×</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {photos.length < PHOTOS_MAX && (
                      <label className={`${classesBouton('contour')} cursor-pointer`}>
                        {photos.length ? 'Ajouter une autre photo' : 'Joindre des photos'}
                        <input type="file" accept="image/*" multiple className="sr-only" data-testid="photos-reserve" onChange={(e) => { void ajouter(e.target.files); e.target.value = ''; }} />
                      </label>
                    )}
                    <p className="text-sm text-discret">{PHOTOS_MAX} photos au plus par réserve. Elles sont jointes à l’annexe de l’état des lieux.</p>
                    <Bouton type="submit" disabled={occupe || texte.trim().length < 5}>{occupe ? 'Envoi…' : 'Déposer cette réserve'}</Bouton>
                  </form>
                )}
              </Carte>
            )}
            {(locataireEntrant || dossier.reserves.length > 0) && (
              <Carte>
                <h2 className="font-bold">{locataireEntrant ? 'Vos réserves' : 'Réserves du locataire'}</h2>
                {dossier.reserves.length === 0 ? <p className="text-sm text-discret">Aucune pour l’instant.</p> : (
                  <ul className="flex flex-col gap-3">
                    {dossier.reserves.map((r, i) => (
                      <li key={i} className="flex flex-col gap-1 border-t border-trait pt-2 text-sm" data-testid="ma-reserve">
                        <span className="flex justify-between gap-3 text-discret"><span>{r.piece ? `${r.piece} · ` : ''}le {instant(r.depose_le)}</span><span className={`font-semibold ${r.statut === 'accepte' ? 'text-neuf' : r.statut === 'refuse' ? 'text-hs' : ''}`}>{STATUTS_RESERVE[r.statut]}</span></span>
                        <span className="text-base">{r.texte}</span>
                        {r.photos.length > 0 && (
                          <span className="grid grid-cols-3 gap-2">
                            {r.photos.map((c, n) => fichiers.photos[c]
                              ? <a key={c} href={complet(fichiers.photos[c])} target="_blank" rel="noreferrer"><img src={complet(fichiers.photos[c])} alt={`Photo ${n + 1} de la réserve${r.piece ? ` — ${r.piece}` : ''}`} loading="lazy" className="aspect-square w-full rounded-xl object-cover" /></a>
                              : <span key={c} className="flex aspect-square items-center justify-center rounded-xl bg-creux text-xs text-discret">Photo {n + 1}</span>)}
                          </span>
                        )}
                        {r.reponse && <span>Réponse du bailleur : {r.reponse}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Carte>
            )}
          </>
        )}
      </main>
    </div>
  );
}
