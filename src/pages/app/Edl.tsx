import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Champ, Liste, classesBouton } from '../../components/ui';
import { STATUTS_EDL, TYPES_EDL, avancement, chargerEdl, completerBrouillonRecu, controlerEdl, elementsDePiece, type Element, type Logement, type Partie, type Piece, type StatutEdl, type TypeEdl } from '../../lib/edl';
import { local } from '../../lib/local';
import { PIECES_TYPES, pieceType } from '../../lib/trame';

interface Fiche {
  id: string;
  type: TypeEdl;
  statut: StatutEdl;
  date_edl: string;
  entree_id: string | null;
  credit_consomme: boolean;
  remarques_generales: string | null;
  source?: string;
  logements: Logement;
}

/** Vue d'ensemble d'un EDL : ce qui est fait, ce qui reste, et l'accès à chaque pièce. */
export function Edl() {
  const { id } = useParams();
  const aller = useNavigate();
  const [edl, setEdl] = useState<Fiche | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [elements, setElements] = useState<Pick<Element, 'piece_id' | 'etat'>[]>([]);
  const [parties, setParties] = useState<Pick<Partie, 'role' | 'nom' | 'prenom'>[]>([]);
  const [introuvable, setIntrouvable] = useState(false);
  const [ajout, setAjout] = useState(false);
  const [typeAjout, setTypeAjout] = useState('chambre');
  const [nomAjout, setNomAjout] = useState('');
  const [aSupprimer, setASupprimer] = useState(false);
  const [controle, setControle] = useState<Awaited<ReturnType<typeof controlerEdl>>>(null);

  const charger = useCallback(async () => {
    const fiche = await chargerEdl(id!);
    if (!fiche) return setIntrouvable(true);
    await completerBrouillonRecu(fiche.edl);
    // L'entrée de référence est gardée sur l'appareil : la sortie l'affichera même sans réseau.
    if (fiche.edl.entree_id) void local.tirerEdl(fiche.edl.entree_id);
    setEdl({ ...fiche.edl, logements: fiche.logement });
    setPieces(await local.lister<Piece>('edl_pieces', 'edl_id', id!));
    setElements(await local.lister('edl_elements', 'edl_id', id!));
    setParties(await local.lister('edl_parties', 'edl_id', id!));
    setControle(await controlerEdl(id!));
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  if (introuvable) return <Alerte>Cet état des lieux n’existe pas ou ne vous est pas accessible. <Link to="/app" className="font-semibold underline">Revenir à la liste</Link></Alerte>;
  if (!edl || !controle) return <p className="text-center text-discret">Chargement…</p>;

  const verrouille = edl.statut === 'signe';
  const global = avancement(elements);
  const locataires = parties.filter((p) => p.role === 'locataire');
  const d = controle.donnees;
  const sans = d.sansCompteurs;
  const bloquants = controle.alertes.filter((x) => x.niveau === 'bloquant').length;

  async function ajouterPiece() {
    const type = pieceType(typeAjout);
    const pieceId = crypto.randomUUID();
    const ordre = pieces.length ? Math.max(...pieces.map((p) => p.ordre)) + 1 : 0;
    await local.inserer('edl_pieces', { id: pieceId, edl_id: edl!.id, zone: type.zone, nom: nomAjout.trim() || type.label, type_piece: type.id, observations: null, ordre }, 'Pièce');
    await local.inserer('edl_elements', elementsDePiece(edl!.id, pieceId, type.id), 'Éléments');
    setAjout(false);
    setNomAjout('');
    await charger();
  }

  return (
    <>
      <Link to="/app" className="text-sm font-semibold text-marque">← Mes états des lieux</Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{edl.logements.libelle}</h1>
          <p className="text-sm text-discret">
            {TYPES_EDL[edl.type]} · {edl.logements.adresse}, {edl.logements.code_postal} {edl.logements.ville}
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full border border-current px-2 text-xs font-semibold ${STATUTS_EDL[edl.statut].couleur}`}>{STATUTS_EDL[edl.statut].libelle}</span>
      </div>

      <div aria-label="Avancement de la visite">
        <div className="h-2 overflow-hidden rounded-full bg-creux">
          <div className="h-full bg-repere" style={{ width: `${global.total ? (100 * global.faits) / global.total : 0}%` }} />
        </div>
        <p className="mt-1 text-sm text-discret" data-testid="avancement">
          {global.faits} élément{global.faits > 1 ? 's' : ''} sur {global.total} constaté{global.faits > 1 ? 's' : ''}
          {global.aSignaler > 0 && ` · ${global.aSignaler} à signaler`}
        </p>
      </div>

      {edl.source === 'signabail' && edl.statut === 'brouillon' && (
        <Alerte ton="succes">Pré-rempli depuis votre bail Signabail : parties, adresse et pièces sont déjà reportées. Vérifiez-les avant de commencer la visite.</Alerte>
      )}
      {edl.type === 'sortant' && !edl.entree_id && (
        <Alerte ton="info">Sans état des lieux d’entrée précis, une retenue sur le dépôt de garantie est très difficile à justifier.</Alerte>
      )}

      <Link to="parties" className="flex items-center justify-between gap-3 rounded-2xl border border-trait bg-surface p-4">
        <span className="min-w-0">
          <span className="block font-semibold">Parties</span>
          <span className="block truncate text-sm text-discret">
            {locataires.length ? `Locataire : ${locataires.map((p) => [p.prenom, p.nom].filter(Boolean).join(' ')).join(', ')}` : 'Locataire à renseigner'}
          </span>
        </span>
        <span className={`whitespace-nowrap text-sm font-semibold ${locataires.length ? 'text-neuf' : 'text-mauvais'}`}>{locataires.length ? 'Complet' : 'À faire'}</span>
      </Link>

      <h2 className="mt-2 text-lg font-bold">Pièces</h2>
      <ul className="flex flex-col gap-2">
        {pieces.map((p) => {
          const av = avancement(elements.filter((x) => x.piece_id === p.id));
          const finie = av.total > 0 && av.faits === av.total;
          return (
            <li key={p.id}>
              <Link to={`pieces/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-trait bg-surface px-4 py-2">
                <span className="min-w-0 truncate font-semibold">{p.nom}</span>
                <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${finie ? 'text-neuf' : 'text-discret'}`}>
                  {av.aSignaler > 0 && <span className="mr-2 text-hs">{av.aSignaler} à signaler</span>}
                  {finie ? 'Fait' : `${av.faits} / ${av.total}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!verrouille &&
        (ajout ? (
          <Carte>
            <Liste id="type-piece" libelle="Type de pièce" value={typeAjout} onChange={(e) => setTypeAjout(e.target.value)}>
              {PIECES_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Liste>
            <Champ id="nom-piece" libelle="Nom" value={nomAjout} onChange={(e) => setNomAjout(e.target.value)} placeholder={pieceType(typeAjout).label} aide="Facultatif : « Chambre parentale », « Cellier »…" />
            <div className="grid grid-cols-2 gap-3">
              <Bouton variante="contour" onClick={() => setAjout(false)}>Annuler</Bouton>
              <Bouton onClick={ajouterPiece}>Ajouter</Bouton>
            </div>
          </Carte>
        ) : (
          <Bouton variante="contour" onClick={() => setAjout(true)}>Ajouter une pièce ou un extérieur</Bouton>
        ))}

      <h2 className="mt-2 text-lg font-bold">Compteurs, clés et contrôles</h2>
      <Etape vers="compteurs" titre="Compteurs" detail={sans ? 'Non concerné (garage)' : `${d.compteurs.filter((c) => c.absent || c.index_1 !== null).length} sur 4 relevés ou déclarés`} fait={sans || d.compteurs.filter((c) => c.absent || c.index_1 !== null).length === 4} />
      <Etape vers="cles" titre="Clés et accès" detail={d.cles.length ? `${d.cles.reduce((s, c) => s + c.nombre, 0)} remis` : 'Aucune clé décrite'} fait={d.cles.length > 0} />
      {d.meuble && !sans && (
        <Etape vers="inventaire" titre="Inventaire du mobilier" detail={`${new Set(d.inventaire.map((i) => i.code_decret).filter(Boolean)).size} équipements obligatoires sur 11`} fait={new Set(d.inventaire.map((i) => i.code_decret).filter(Boolean)).size === 11} />
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="remarques" className="font-semibold">Remarques générales</label>
        <textarea id="remarques" rows={3} disabled={verrouille} defaultValue={edl.remarques_generales ?? ''} placeholder="Logement propre, repeint avant l’entrée…"
          className="w-full rounded-xl border border-trait bg-surface px-3 py-2 text-base placeholder:text-discret"
          onBlur={async (e) => {
            const v = e.target.value.trim() || null;
            if (v !== edl.remarques_generales) { await local.modifier('edl', edl.id, { remarques_generales: v }, 'Remarques générales'); await charger(); }
          }} />
      </div>
      <Link to="controles" className={`${classesBouton(bloquants ? 'contour' : 'repere')}`} data-testid="lien-controles">
        {bloquants ? `Contrôles : ${bloquants} point${bloquants > 1 ? 's' : ''} à corriger` : 'Contrôles : tout est complet'}
      </Link>

      {edl.statut === 'brouillon' && !edl.credit_consomme &&
        (aSupprimer ? (
          <Carte>
            <p className="font-semibold">Supprimer ce brouillon et tout ce qu’il contient ?</p>
            <div className="grid grid-cols-2 gap-3">
              <Bouton variante="contour" onClick={() => setASupprimer(false)}>Garder</Bouton>
              <button
                className={`${classesBouton('plein')} !bg-hs !text-surface`}
                onClick={async () => {
                  await local.supprimer('edl', edl.id, 'Suppression du brouillon');
                  aller('/app', { replace: true });
                }}
              >
                Supprimer
              </button>
            </div>
          </Carte>
        ) : (
          <button className="text-sm font-semibold text-hs underline-offset-4 hover:underline" onClick={() => setASupprimer(true)}>Supprimer ce brouillon</button>
        ))}
    </>
  );
}

function Etape({ vers, titre, detail, fait }: { vers: string; titre: string; detail: string; fait: boolean }) {
  return (
    <Link to={vers} className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-trait bg-surface px-4 py-2">
      <span className="min-w-0">
        <span className="block font-semibold">{titre}</span>
        <span className="block truncate text-sm text-discret">{detail}</span>
      </span>
      <span className={`whitespace-nowrap text-sm font-semibold ${fait ? 'text-neuf' : 'text-mauvais'}`}>{fait ? 'Fait' : 'À faire'}</span>
    </Link>
  );
}
