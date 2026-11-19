import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Champ } from '../../components/ui';
import { avancement, chargerEdl, type Element, type Piece } from '../../lib/edl';
import { local } from '../../lib/local';
import { ajouterPhrase, phrasesTypes } from '../../lib/phrases';
import { ETATS, detailAttendu, libelleEtat, type Etat } from '../../lib/trame';

type Origine = Pick<Element, 'id' | 'etat' | 'observations' | 'fonctionne'>;
const ZONE = 'min-h-[48px] w-full rounded-xl border border-trait bg-surface px-3 py-2 text-base text-encre placeholder:text-discret';

/** La visite d'une pièce : un appui par élément, le détail à la demande. */
export function EdlPiece() {
  const { id, pieceId } = useParams();
  const aller = useNavigate();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [elements, setElements] = useState<Element[]>([]);
  const [origines, setOrigines] = useState<Map<string, Origine>>(new Map());
  const [verrouille, setVerrouille] = useState(false);
  // La pièce dont les éléments sont à l'écran : tant que ce n'est pas celle de l'adresse, on n'affiche rien d'elle.
  const [chargee, setChargee] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState('');
  const [gestion, setGestion] = useState(false);
  const [nomPiece, setNomPiece] = useState('');

  const charger = useCallback(async () => {
    const fiche = await chargerEdl(id!);
    const lesPieces = await local.lister<Piece>('edl_pieces', 'edl_id', id!);
    const els = await local.lister<Element>('edl_elements', 'piece_id', pieceId!);
    setPieces(lesPieces);
    setElements(els);
    setVerrouille(fiche?.edl.statut === 'signe');
    setNomPiece(lesPieces.find((p) => p.id === pieceId)?.nom ?? '');
    // Sortie : l'état constaté à l'entrée, affiché en regard (lu sur l'appareil).
    const trouves = new Map<string, Origine>();
    if (fiche?.edl.entree_id) {
      await local.tirerEdl(fiche.edl.entree_id);
      for (const x of els) {
        const o = x.origine_id ? await local.lire<Origine>('edl_elements', x.origine_id) : undefined;
        if (o) trouves.set(o.id, o);
      }
    }
    setOrigines(trouves);
    setOuvert(null);
    setGestion(false);
    setChargee(pieceId!);
  }, [id, pieceId]);
  useEffect(() => { void charger(); }, [charger]);

  const piece = pieces.find((p) => p.id === pieceId);
  if (chargee !== pieceId) return <p className="text-center text-discret">Chargement…</p>;
  if (!piece) return <Alerte>Cette pièce n’existe plus. <Link to={`/app/edl/${id}`} className="font-semibold underline">Revenir à l’état des lieux</Link></Alerte>;

  const rang = pieces.findIndex((p) => p.id === pieceId);
  const suivante = pieces[rang + 1];
  const av = avancement(elements);
  const sansEtat = elements.filter((x) => x.etat === null);
  // Sortie : les éléments pas encore constatés dont l'état d'entrée est connu.
  const reprenables = sansEtat.filter((x) => x.origine_id && origines.get(x.origine_id)?.etat);

  /** « Le reste est en bon état » : on note les défauts d'abord, puis on solde ce qui reste. */
  async function solderEnBonEtat() {
    for (const x of sansEtat) await modifier(x.id, { etat: 'bon' });
  }
  /** Sortie : ce qui n'a pas changé depuis l'entrée reprend son état et sa remarque d'alors. */
  async function reprendreEntree() {
    for (const x of reprenables) {
      const o = origines.get(x.origine_id!)!;
      await modifier(x.id, { etat: o.etat, fonctionne: o.fonctionne ?? null, ...(x.observations ? {} : { observations: o.observations }) });
    }
  }
  async function dupliquer(el: Element) {
    const nb = elements.filter((x) => x.categorie === el.categorie && x.libelle.startsWith(el.libelle.replace(/ \d+$/, ''))).length;
    const copie: Element = { ...el, id: crypto.randomUUID(), libelle: `${el.libelle.replace(/ \d+$/, '')} ${nb + 1}`, etat: null, observations: null, detail: null, fonctionne: null, origine_id: null };
    const { ...ligne } = copie as Element & { _cree?: string; created_at?: string; updated_at?: string };
    delete ligne._cree; delete ligne.created_at; delete ligne.updated_at;
    await local.inserer('edl_elements', ligne, `${piece!.nom}, ${copie.libelle}`);
    setElements(await local.lister<Element>('edl_elements', 'piece_id', pieceId!));
  }

  /** Mise à jour immédiate à l'écran et sur l'appareil ; l'envoi au serveur suit. */
  async function modifier(elId: string, champs: Partial<Element>) {
    setElements((liste) => liste.map((x) => (x.id === elId ? { ...x, ...champs } : x)));
    await local.modifier('edl_elements', elId, champs, `${piece!.nom}, ${elements.find((x) => x.id === elId)?.libelle ?? 'élément'}`);
  }

  async function ajouterElement() {
    const libelle = nouveau.trim();
    if (!libelle) return;
    const ligne = { id: crypto.randomUUID(), edl_id: id!, piece_id: pieceId!, categorie: 'autre', libelle, ordre: elements.length ? Math.max(...elements.map((x) => x.ordre)) + 1 : 0 };
    await local.inserer('edl_elements', { ...ligne, nature: null, etat: null, observations: null, detail: null, origine_id: null }, `${piece!.nom}, ${libelle}`);
    setNouveau('');
    setElements((liste) => [...liste, { ...ligne, nature: null, etat: null, observations: null, detail: null, origine_id: null }]);
  }

  return (
    <>
      <Link to={`/app/edl/${id}`} className="text-sm font-semibold text-marque">← Toutes les pièces</Link>
      <div className="flex items-end justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-bold">{piece.nom}</h1>
        <p className="whitespace-nowrap text-sm text-discret tabular-nums">pièce {rang + 1} / {pieces.length} · {av.faits} / {av.total}</p>
      </div>
      {verrouille && <Alerte ton="info">État des lieux signé : il ne peut plus être modifié.</Alerte>}

      <ul className="flex flex-col gap-3">
        {elements.map((el) => {
          const origine = el.origine_id ? origines.get(el.origine_id) : undefined;
          const precision = detailAttendu(piece.type_piece, el.categorie);
          const estOuvert = ouvert === el.id;
          const ecart = origine?.etat && el.etat && el.etat !== 'sans_objet' && origine.etat !== el.etat;
          return (
            <li key={el.id} className="flex flex-col gap-2 rounded-2xl border border-trait bg-surface p-3" data-testid={`element-${el.categorie}`}>
              <button type="button" className="flex items-center justify-between gap-3 text-left" aria-expanded={estOuvert} onClick={() => setOuvert(estOuvert ? null : el.id)}>
                <span className="min-w-0">
                  <span className="block font-semibold">{el.libelle}{el.nature ? ` · ${el.nature}` : ''}</span>
                  {origine && <span className={`block text-sm ${ecart ? 'font-semibold text-mauvais' : 'text-discret'}`}>À l’entrée : {libelleEtat(origine.etat)}</span>}
                  {el.etat === 'sans_objet' && <span className="block text-sm text-discret">Sans objet</span>}
                  {el.fonctionne === false && <span className="block text-sm font-semibold text-hs">Ne fonctionne pas</span>}
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-marque">{estOuvert ? 'Fermer' : el.observations ? 'Note ✓' : 'Détail'}</span>
              </button>
              <div role="group" aria-label={`État : ${el.libelle}`} className="grid grid-cols-5 gap-1.5">
                {ETATS.map((x) => {
                  const actif = el.etat === x.id;
                  return (
                    <button key={x.id} type="button" disabled={verrouille} aria-pressed={actif} title={x.label} aria-label={x.label}
                      onClick={() => modifier(el.id, { etat: actif ? null : x.id })}
                      className={`min-h-[48px] rounded-xl border-2 text-sm font-bold ${actif ? `${x.classe} border-transparent text-surface` : 'border-trait text-discret'}`}>
                      {x.court}
                    </button>
                  );
                })}
              </div>
              {estOuvert && (
                <fieldset disabled={verrouille} className="flex flex-col gap-3 border-t border-trait pt-3">
                  <Champ id={`nature-${el.id}`} libelle="Nature, matériau" defaultValue={el.nature ?? ''} placeholder="Parquet stratifié, PVC double vitrage…"
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== el.nature) void modifier(el.id, { nature: v }); }} />
                  {precision && (
                    <Champ id={`detail-${el.id}`} libelle={precision} defaultValue={el.detail ?? ''}
                      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== el.detail) void modifier(el.id, { detail: v }); }} />
                  )}
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`obs-${el.id}`} className="text-sm font-semibold">Observations</label>
                    <textarea id={`obs-${el.id}`} key={el.observations ?? ''} rows={3} className={ZONE} defaultValue={el.observations ?? ''} placeholder="Rayure de 10 cm près de la fenêtre…"
                      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== el.observations) void modifier(el.id, { observations: v }); }} />
                    {origine?.observations && <p className="text-sm text-discret">À l’entrée : {origine.observations}</p>}
                    <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Phrases types">
                      {phrasesTypes(el.categorie).map((phrase) => (
                        <button key={phrase} type="button" onClick={() => modifier(el.id, { observations: ajouterPhrase(el.observations, phrase) })}
                          className="min-h-[36px] rounded-full border border-trait px-3 text-sm text-discret hover:border-marque hover:text-marque">
                          {phrase}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div role="group" aria-label={`Fonctionnement : ${el.libelle}`} className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">Essayé sur place</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([['Fonctionne', true], ['Ne fonctionne pas', false], ['Non testé', null]] as const).map(([libelle, valeur]) => (
                        <button key={libelle} type="button" aria-pressed={(el.fonctionne ?? null) === valeur} onClick={() => modifier(el.id, { fonctionne: valeur })}
                          className={`min-h-[44px] rounded-xl border-2 px-1 text-sm font-semibold ${(el.fonctionne ?? null) === valeur ? 'border-marque bg-marque text-sur-marque' : 'border-trait text-discret'}`}>
                          {libelle}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Bouton variante="contour" className="!px-1 !text-sm" onClick={() => modifier(el.id, { etat: el.etat === 'sans_objet' ? null : ('sans_objet' as Etat) })}>
                      {el.etat === 'sans_objet' ? 'À constater' : 'Sans objet'}
                    </Bouton>
                    <Bouton variante="contour" className="!px-1 !text-sm" onClick={() => dupliquer(el)}>Dupliquer</Bouton>
                    <Bouton variante="contour" className="!border-hs !px-1 !text-sm !text-hs" onClick={async () => {
                      await local.supprimer('edl_elements', el.id, `${piece.nom}, ${el.libelle}`);
                      setElements((liste) => liste.filter((x) => x.id !== el.id));
                    }}>Retirer</Bouton>
                  </div>
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>

      {!verrouille && reprenables.length > 0 && (
        <Bouton variante="contour" onClick={reprendreEntree}>
          Inchangé depuis l’entrée : reprendre {reprenables.length > 1 ? `les ${reprenables.length} éléments restants` : 'l’élément restant'}
        </Bouton>
      )}
      {!verrouille && sansEtat.length > 0 && (
        <Bouton variante="contour" onClick={solderEnBonEtat}>
          Le reste est en bon état ({sansEtat.length} élément{sansEtat.length > 1 ? 's' : ''})
        </Bouton>
      )}
      {!verrouille && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void ajouterElement(); }}>
          <div className="flex-1"><Champ id="nouvel-element" libelle="Ajouter un élément" value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder="Cheminée, verrière…" /></div>
          <Bouton type="submit" variante="contour" className="!w-auto" disabled={!nouveau.trim()}>Ajouter</Bouton>
        </form>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="obs-piece" className="text-sm font-semibold">Observations sur la pièce</label>
        <textarea id="obs-piece" rows={2} disabled={verrouille} className={ZONE} defaultValue={piece.observations ?? ''}
          onBlur={async (e) => {
            const v = e.target.value.trim() || null;
            if (v === piece.observations) return;
            await local.modifier('edl_pieces', piece.id, { observations: v }, piece.nom);
            setPieces((l) => l.map((p) => (p.id === piece.id ? { ...p, observations: v } : p)));
          }} />
      </div>

      {suivante ? (
        <Link to={`/app/edl/${id}/pieces/${suivante.id}`} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-marque px-4 text-base font-semibold text-sur-marque">
          Pièce suivante : {suivante.nom}
        </Link>
      ) : (
        <Link to={`/app/edl/${id}`} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-marque px-4 text-base font-semibold text-sur-marque">
          Dernière pièce : revenir à la vue d’ensemble
        </Link>
      )}

      {!verrouille &&
        (gestion ? (
          <Carte>
            <Champ id="renommer" libelle="Nom de la pièce" value={nomPiece} onChange={(e) => setNomPiece(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Bouton variante="contour" className="!border-hs !text-hs" onClick={async () => {
                await local.supprimer('edl_pieces', piece.id, piece.nom);
                aller(`/app/edl/${id}`, { replace: true });
              }}>Supprimer la pièce</Bouton>
              <Bouton disabled={!nomPiece.trim()} onClick={async () => {
                await local.modifier('edl_pieces', piece.id, { nom: nomPiece.trim() }, piece.nom);
                setPieces((l) => l.map((p) => (p.id === piece.id ? { ...p, nom: nomPiece.trim() } : p)));
                setGestion(false);
              }}>Renommer</Bouton>
            </div>
          </Carte>
        ) : (
          <button className="text-sm font-semibold text-marque underline-offset-4 hover:underline" onClick={() => setGestion(true)}>Renommer ou supprimer cette pièce</button>
        ))}
    </>
  );
}
