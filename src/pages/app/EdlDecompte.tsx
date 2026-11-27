import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EnteteEdl } from '../../components/EnteteEdl';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { bilan, centimes, decomptePdf, degradations, euros, montantRetenu, vetustePct, type LigneGrille, type Retenue } from '../../lib/decompte';
import { chargerEdl, type EdlLigne, type Element, type Logement, type Partie, type Piece } from '../../lib/edl';
import { local } from '../../lib/local';
import { supabase } from '../../lib/supabase';
import { libelleEtat } from '../../lib/trame';

const GRILLE_DEFAUT = '00000000-0000-4000-8000-000000000001';
const nomDe = (p: Pick<Partie, 'civilite' | 'prenom' | 'nom'>) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');
const enEuros = (c: number | null | undefined) => (c ? (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, useGrouping: false }) : '');
interface Decompte { depot_cents: number; autres_sommes_cents: number; autres_sommes_motif: string | null; date_remise_cles: string }

/** Décompte du dépôt de garantie d'un état des lieux de sortie : dégradations, retenues, vétusté, délai de restitution. */
export function EdlDecompte() {
  const { id } = useParams();
  const [edl, setEdl] = useState<EdlLigne | null>(null);
  const [logement, setLogement] = useState<Logement | null>(null);
  const [parties, setParties] = useState<Partie[]>([]);
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [sortie, setSortie] = useState<Element[]>([]);
  const [entree, setEntree] = useState<Element[]>([]);
  const [grille, setGrille] = useState<LigneGrille[]>([]);
  const [retenues, setRetenues] = useState<Retenue[]>([]);
  const [decompte, setDecompte] = useState<Decompte | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pret, setPret] = useState(false);

  const charger = useCallback(async () => {
    const fiche = await chargerEdl(id!);
    if (!fiche) return setErreur('Cet état des lieux n’existe pas ou ne vous est pas accessible.');
    setEdl(fiche.edl); setLogement(fiche.logement);
    if (fiche.edl.entree_id) await local.tirerEdl(fiche.edl.entree_id).catch(() => undefined);
    setParties(await local.lister<Partie>('edl_parties', 'edl_id', id!));
    setPieces(Object.fromEntries((await local.lister<Piece>('edl_pieces', 'edl_id', id!)).map((p) => [p.id, p.nom])));
    setSortie(await local.lister<Element>('edl_elements', 'edl_id', id!));
    setEntree(fiche.edl.entree_id ? await local.lister<Element>('edl_elements', 'edl_id', fiche.edl.entree_id) : []);
    const [g, r, d] = await Promise.all([
      supabase.from('grille_vetuste_lignes').select('id, categorie, libelle, duree_vie_ans, franchise_ans, part_residuelle_pct, ordre').eq('grille_id', (fiche.edl as EdlLigne & { grille_vetuste_id?: string | null }).grille_vetuste_id ?? GRILLE_DEFAUT).order('ordre'),
      supabase.from('retenues').select('id, edl_id, element_id, libelle, montant_devis_cents, ligne_grille_id, age_ans, vetuste_pct, montant_retenu_cents').eq('edl_id', id!).order('created_at'),
      supabase.from('decomptes').select('depot_cents, autres_sommes_cents, autres_sommes_motif, date_remise_cles').eq('edl_id', id!).maybeSingle(),
    ]);
    if (g.error || r.error || d.error) return setErreur('Le décompte se prépare avec une connexion. Vérifiez le réseau puis rechargez la page.');
    setGrille((g.data ?? []) as LigneGrille[]);
    setRetenues(((r.data ?? []) as Retenue[]).map((x) => ({ ...x, age_ans: x.age_ans === null ? null : Number(x.age_ans), vetuste_pct: Number(x.vetuste_pct) })));
    setDecompte((d.data as Decompte | null) ?? { depot_cents: fiche.edl.depot_garantie_cents ?? 0, autres_sommes_cents: 0, autres_sommes_motif: null, date_remise_cles: fiche.edl.date_edl.slice(0, 10) });
    setPret(true);
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  const ecarts = useMemo(() => degradations(sortie, entree), [sortie, entree]);
  const b = decompte ? bilan(decompte.depot_cents, retenues, decompte.autres_sommes_cents, decompte.date_remise_cles, ecarts.length) : null;

  /** Le décompte est gardé à chaque modification : son total suit les retenues. */
  async function garder(d: Decompte, liste: Retenue[]) {
    setDecompte(d);
    const s = bilan(d.depot_cents, liste, d.autres_sommes_cents, d.date_remise_cles, ecarts.length);
    const { error } = await supabase.from('decomptes').upsert({ edl_id: id!, ...d, total_retenues_cents: s.retenues, conforme: s.conforme });
    setErreur(error ? 'Le décompte n’a pas pu être enregistré. Vérifiez votre connexion.' : null);
  }
  async function ajouter(libelle: string, elementId: string | null) {
    const ligne: Retenue = { id: crypto.randomUUID(), edl_id: id!, element_id: elementId, libelle, montant_devis_cents: 0, ligne_grille_id: null, age_ans: null, vetuste_pct: 0, montant_retenu_cents: 0 };
    const { error } = await supabase.from('retenues').insert(ligne);
    if (error) return setErreur('La retenue n’a pas pu être ajoutée. Vérifiez votre connexion.');
    const suite = [...retenues, ligne];
    setRetenues(suite);
    if (decompte) await garder(decompte, suite);
  }
  async function modifier(r: Retenue, champs: Partial<Retenue>) {
    const brut = { ...r, ...champs };
    const ligneGrille = grille.find((g) => g.id === brut.ligne_grille_id);
    const pct = ligneGrille && brut.age_ans !== null ? vetustePct(ligneGrille, brut.age_ans) : 0;
    const maj: Retenue = { ...brut, vetuste_pct: pct, montant_retenu_cents: montantRetenu(brut.montant_devis_cents, pct) };
    const suite = retenues.map((x) => (x.id === r.id ? maj : x));
    setRetenues(suite);
    const { error } = await supabase.from('retenues').update({ libelle: maj.libelle, montant_devis_cents: maj.montant_devis_cents, ligne_grille_id: maj.ligne_grille_id, age_ans: maj.age_ans, vetuste_pct: maj.vetuste_pct, montant_retenu_cents: maj.montant_retenu_cents }).eq('id', r.id);
    if (error) return setErreur('La retenue n’a pas pu être enregistrée. Vérifiez votre connexion.');
    if (decompte) await garder(decompte, suite);
  }
  async function retirer(r: Retenue) {
    const { error } = await supabase.from('retenues').delete().eq('id', r.id);
    if (error) return setErreur('La retenue n’a pas pu être retirée. Vérifiez votre connexion.');
    const suite = retenues.filter((x) => x.id !== r.id);
    setRetenues(suite);
    if (decompte) await garder(decompte, suite);
  }
  async function telecharger() {
    if (!edl || !logement || !decompte || !b) return;
    const pdf = await decomptePdf({
      adresse: `${logement.adresse}, ${logement.code_postal} ${logement.ville}`,
      bailleur: parties.filter((p) => p.role === 'bailleur').map(nomDe).join(', '), locataires: parties.filter((p) => p.role === 'locataire').map(nomDe).join(', '),
      dateSortie: edl.date_edl.slice(0, 10), remiseCles: decompte.date_remise_cles, bilan: b, autresMotif: decompte.autres_sommes_motif,
      retenues: retenues.filter((r) => r.montant_devis_cents > 0).map((r) => ({ libelle: r.libelle, devis: r.montant_devis_cents, vetuste: r.vetuste_pct, retenu: r.montant_retenu_cents, grille: grille.find((g) => g.id === r.ligne_grille_id)?.libelle ?? null, age: r.age_ans })),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    a.download = `decompte-depot-de-garantie-${edl.date_edl.slice(0, 10)}.pdf`;
    a.click();
  }

  if (erreur && !pret) return <Alerte>{erreur} <Link to="/app" className="font-semibold underline">Revenir à la liste</Link></Alerte>;
  if (!pret || !edl || !decompte || !b) return <p className="text-center text-discret">Chargement…</p>;
  if (edl.type !== 'sortant') return <Alerte ton="info">Le décompte du dépôt de garantie se prépare sur un état des lieux de sortie. <Link to={`/app/edl/${id}`} className="font-semibold underline">Revenir à l’état des lieux</Link></Alerte>;
  const jour = (j: string) => new Date(`${j}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dejaRetenus = new Set(retenues.map((r) => r.element_id));

  return (
    <>
      <EnteteEdl id={id!} titre="Dépôt de garantie" verrouille={false}
        intro="Chiffrez ce qui revient au locataire : le dépôt, moins les réparations justifiées et les sommes restant dues. Tout s’enregistre au fur et à mesure." />
      {erreur && <Alerte>{erreur}</Alerte>}

      <Carte>
        <h2 className="text-lg font-bold">Dépôt et remise des clés</h2>
        <Champ id="depot" libelle="Dépôt de garantie versé (€)" inputMode="decimal" defaultValue={enEuros(decompte.depot_cents)} placeholder="800,00"
          onBlur={(e) => { const c = centimes(e.target.value || '0'); if (c !== null && c !== decompte.depot_cents) void garder({ ...decompte, depot_cents: c }, retenues); }} />
        <Champ id="remise" libelle="Date de remise des clés" type="date" value={decompte.date_remise_cles} aide="Le délai de restitution court à partir de cette date."
          onChange={(e) => { if (e.target.value) void garder({ ...decompte, date_remise_cles: e.target.value }, retenues); }} />
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Dégradations depuis l’entrée</h2>
        {!edl.entree_id ? <p className="text-sm text-discret">L’état des lieux d’entrée n’a pas été fait sur Constatio : comparez à la main avec votre document d’entrée, puis ajoutez vos retenues ci-dessous.</p>
          : ecarts.length === 0 ? <p className="text-sm font-semibold text-neuf" data-testid="aucun-ecart">Aucun élément n’est plus abîmé qu’à l’entrée.</p> : (
            <ul className="flex flex-col gap-2">
              {ecarts.map(({ element, avant, apres }) => (
                <li key={element.id} className="flex flex-col gap-2 rounded-xl border border-trait p-3 text-sm" data-testid="ecart">
                  <span><span className="font-semibold">{pieces[element.piece_id] ?? 'Pièce'} · {element.libelle}</span><br />{libelleEtat(avant)} à l’entrée, <span className="font-semibold text-mauvais">{libelleEtat(apres).toLowerCase()} à la sortie</span>{element.observations ? ` : ${element.observations}` : ''}</span>
                  {dejaRetenus.has(element.id) ? <span className="text-discret">Retenue ajoutée.</span>
                    : <Bouton variante="contour" className="!min-h-[44px]" onClick={() => ajouter(`${pieces[element.piece_id] ?? 'Pièce'} : ${element.libelle.toLowerCase()}`, element.id)}>Ajouter une retenue</Bouton>}
                </li>
              ))}
            </ul>
          )}
        <p className="text-sm text-discret">L’usure normale ne se retient pas : seules les dégradations et les réparations locatives non faites sont à la charge du locataire (loi du 6 juillet 1989, article 7).</p>
      </Carte>

      <Carte className="lg:col-span-2">
        <h2 className="text-lg font-bold">Retenues</h2>
        {retenues.length === 0 && <p className="text-sm text-discret">Aucune retenue. Sans retenue ni dégradation, le dépôt se restitue en entier, dans le mois.</p>}
        <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start">
          {retenues.map((r) => {
            const ligneGrille = grille.find((g) => g.id === r.ligne_grille_id);
            return (
              <li key={r.id} className="flex flex-col gap-3 rounded-xl border border-trait p-3" data-testid="retenue">
                <Champ id={`lib-${r.id}`} libelle="Réparation" defaultValue={r.libelle} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.libelle) void modifier(r, { libelle: v }); }} />
                <Champ id={`devis-${r.id}`} libelle="Montant du devis ou de la facture (€)" inputMode="decimal" defaultValue={enEuros(r.montant_devis_cents)} placeholder="450,00" aide="Une retenue se justifie par un devis ou une facture, à joindre au décompte."
                  onBlur={(e) => { const c = centimes(e.target.value || '0'); if (c !== null && c !== r.montant_devis_cents) void modifier(r, { montant_devis_cents: c }); }} />
                <Liste id={`grille-${r.id}`} libelle="Vétusté à déduire" value={r.ligne_grille_id ?? ''} onChange={(e) => void modifier(r, { ligne_grille_id: e.target.value || null, age_ans: e.target.value ? r.age_ans : null })}>
                  <option value="">Aucune (dégradation, ou élément récent)</option>
                  {grille.map((g) => <option key={g.id} value={g.id}>{g.libelle} · durée de vie {g.duree_vie_ans} ans</option>)}
                </Liste>
                {ligneGrille && (
                  <Champ id={`age-${r.id}`} libelle="Âge de l’élément à la sortie (années)" inputMode="decimal" defaultValue={r.age_ans === null ? '' : String(r.age_ans).replace('.', ',')} placeholder="4"
                    aide={`Franchise de ${ligneGrille.franchise_ans} an${ligneGrille.franchise_ans > 1 ? 's' : ''}, ${ligneGrille.part_residuelle_pct} % restent toujours à la charge du locataire.`}
                    onBlur={(e) => { const v = e.target.value.trim().replace(',', '.'); const n = v === '' ? null : Number(v); if (n === null || (Number.isFinite(n) && n >= 0 && n < 200)) void modifier(r, { age_ans: n === null ? null : Math.round(n * 10) / 10 }); }} />
                )}
                <p className="flex items-baseline justify-between gap-3 border-t border-trait pt-2 text-sm">
                  <span className="text-discret">{r.vetuste_pct > 0 ? `Vétusté déduite : ${String(r.vetuste_pct).replace('.', ',')} %` : 'Sans déduction de vétusté'}</span>
                  <span className="font-titre text-lg font-bold tabular-nums" data-testid="montant-retenu">{euros(r.montant_retenu_cents)}</span>
                </p>
                <button type="button" className="self-start text-sm font-semibold text-hs underline-offset-4 hover:underline" onClick={() => retirer(r)}>Retirer cette retenue</button>
              </li>
            );
          })}
        </ul>
        <Bouton variante="contour" className="lg:!w-auto lg:self-start lg:px-5" onClick={() => ajouter('Réparation', null)} data-testid="ajouter-retenue">Ajouter une retenue</Bouton>
        <p className="text-sm text-discret">La grille de vétusté est indicative, avec des durées usuelles à faire valider. Elle ne s’impose aux parties que si elles en sont convenues au bail (décret du 30 mars 2016, article 4) ; à défaut, elle vous aide à proposer une retenue équitable.</p>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Autres sommes restant dues</h2>
        <Champ id="autres" libelle="Loyers ou charges impayés (€)" inputMode="decimal" defaultValue={enEuros(decompte.autres_sommes_cents)} placeholder="0,00"
          onBlur={(e) => { const c = centimes(e.target.value || '0'); if (c !== null && c !== decompte.autres_sommes_cents) void garder({ ...decompte, autres_sommes_cents: c }, retenues); }} />
        <Champ id="motif" libelle="Précision" defaultValue={decompte.autres_sommes_motif ?? ''} placeholder="Loyer de novembre, régularisation de charges…"
          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== decompte.autres_sommes_motif) void garder({ ...decompte, autres_sommes_motif: v }, retenues); }} />
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">À restituer</h2>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3"><dt>Dépôt de garantie</dt><dd className="tabular-nums">{euros(b.depot)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Retenues pour réparations</dt><dd className="tabular-nums">- {euros(b.retenues)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Autres sommes dues</dt><dd className="tabular-nums">- {euros(b.autres)}</dd></div>
        </dl>
        <p className="flex items-baseline justify-between gap-3 border-t-2 border-encre pt-3">
          <span className="font-semibold">Somme à restituer</span>
          <span className="font-titre text-3xl font-bold tabular-nums" data-testid="a-restituer">{euros(b.aRestituer)}</span>
        </p>
        {b.resteDu > 0 && <Alerte ton="info">Les sommes dues dépassent le dépôt : il reste {euros(b.resteDu)} à réclamer au locataire.</Alerte>}
        <p className="text-sm" data-testid="delai">
          À restituer au plus tard le <span className="font-semibold">{jour(b.dateLimite)}</span> : {b.conforme ? 'un mois après la remise des clés, la sortie étant conforme à l’entrée' : 'deux mois après la remise des clés, la sortie n’étant pas conforme à l’entrée'} (loi du 6 juillet 1989, article 22).
        </p>
        <Bouton onClick={telecharger} data-testid="telecharger-decompte">Télécharger le décompte (PDF)</Bouton>
        <p className="text-sm text-discret">Envoyez-le au locataire avec les devis ou factures. Passé le délai, le dépôt restant dû est majoré de 10 % du loyer mensuel par mois de retard commencé.</p>
      </Carte>
    </>
  );
}
