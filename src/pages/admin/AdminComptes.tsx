import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { ORIGINES, TYPES_COMPTE, appel, jour } from '../../lib/admin';
import { STATUTS_EDL, TYPES_EDL, type StatutEdl, type TypeEdl } from '../../lib/edl';
import { useDonnee } from './CoquilleAdmin';

interface Ligne { id: string; nom: string; type: string; est_test: boolean; cree_le: string; email: string | null; nb_edl: number; credits: number; premium: boolean; signabail: boolean }

export function AdminComptes() {
  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');
  const { donnee: comptes, erreur } = useDonnee(() => appel<Ligne[]>('admin_comptes', { p_recherche: recherche || null }), [recherche]);
  return (
    <>
      <h1 className="text-2xl font-bold">Comptes</h1>
      <form className="flex max-w-xl items-end gap-2" onSubmit={(e) => { e.preventDefault(); setRecherche(saisie.trim()); }}>
        <div className="flex-1"><Champ id="recherche" libelle="Rechercher par nom ou adresse e-mail" value={saisie} onChange={(e) => setSaisie(e.target.value)} /></div>
        <Bouton type="submit" className="!w-auto">Chercher</Bouton>
      </form>
      {erreur && <Alerte>{erreur}</Alerte>}
      {comptes && comptes.length === 0 && <p className="text-discret">Aucun compte ne correspond.</p>}
      {comptes && comptes.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-trait bg-surface">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead><tr className="border-b-2 border-encre text-discret">
              <th className="px-3 py-2 font-semibold">Compte</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Créé le</th>
              <th className="px-3 py-2 text-right font-semibold">États des lieux</th><th className="px-3 py-2 text-right font-semibold">Crédits</th><th className="px-3 py-2 font-semibold">Repères</th>
            </tr></thead>
            <tbody>
              {comptes.map((c) => (
                <tr key={c.id} className="border-b border-trait last:border-0">
                  <td className="px-3 py-2"><Link to={`/admin/comptes/${c.id}`} className="font-semibold text-marque underline underline-offset-4">{c.nom}</Link><span className="block text-discret">{c.email ?? '—'}</span></td>
                  <td className="px-3 py-2">{TYPES_COMPTE[c.type]}</td>
                  <td className="px-3 py-2 tabular-nums">{jour(c.cree_le)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.nb_edl}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.credits}</td>
                  <td className="px-3 py-2 text-discret">{[c.premium && 'Premium', c.signabail && 'Signabail', c.est_test && 'Test'].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {comptes && comptes.length === 50 && <p className="text-sm text-discret">Les 50 comptes les plus récents sont affichés. Précisez la recherche pour en trouver un autre.</p>}
    </>
  );
}

interface Detail {
  organisation: { id: string; nom: string; type: string; siret: string | null; ville: string | null; est_test: boolean; cree_le: string; signabail: boolean };
  membres: { email: string; role: string; depuis: string }[];
  lots: { id: string; origine: string; quantite: number; restant: number; type_reserve: TypeEdl | null; expire_le: string; cree_le: string }[];
  edl: { id: string; type: TypeEdl; statut: StatutEdl; date: string; ville: string; source: string }[];
  premium: boolean;
}
const ROLES: Record<string, string> = { proprietaire: 'Propriétaire', admin: 'Administrateur du compte', agent: 'Agent' };

export function AdminCompte() {
  const { id } = useParams();
  const { donnee: d, erreur, recharger } = useDonnee(() => appel<Detail | null>('admin_compte', { p_org: id }), [id]);
  const [quantite, setQuantite] = useState('1');
  const [reserve, setReserve] = useState('');
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  const [aRetirer, setARetirer] = useState<string | null>(null);

  if (erreur) return <Alerte>{erreur}</Alerte>;
  if (d === null) return <p className="text-discret">Chargement…</p>;
  if (!d) return <Alerte>Ce compte n’existe pas.</Alerte>;
  const o = d.organisation;
  const agir = async (action: () => Promise<unknown>, succes: string) => {
    try { await action(); setRetour({ ton: 'succes', texte: succes }); await recharger(); }
    catch (e) { setRetour({ ton: 'erreur', texte: (e as Error).message }); }
  };
  const offrir = (e: FormEvent) => {
    e.preventDefault();
    void agir(() => appel('admin_offrir_credits', { p_org: o.id, p_quantite: Number(quantite), p_motif: motif, p_type_reserve: reserve || null }),
      `${quantite} crédit${Number(quantite) > 1 ? 's' : ''} offert${Number(quantite) > 1 ? 's' : ''}, valable${Number(quantite) > 1 ? 's' : ''} 24 mois.`).then(() => setMotif(''));
  };

  return (
    <>
      <Link to="/admin/comptes" className="text-sm font-semibold text-marque">← Tous les comptes</Link>
      <div>
        <h1 className="text-2xl font-bold">{o.nom}</h1>
        <p className="text-sm text-discret">{TYPES_COMPTE[o.type]}{o.ville ? ` · ${o.ville}` : ''} · créé le {jour(o.cree_le)}{d.premium ? ' · Premium' : ''}{o.signabail ? ' · relié à Signabail' : ''}{o.est_test ? ' · compte de test' : ''}</p>
      </div>
      {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}

      <Carte>
        <h2 className="text-lg font-bold">Membres</h2>
        <ul className="flex flex-col gap-1 text-sm">{d.membres.map((m) => <li key={m.email}><span className="font-semibold">{m.email}</span> · {ROLES[m.role]} · depuis le {jour(m.depuis)}</li>)}</ul>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Crédits</h2>
        {d.lots.length === 0 ? <p className="text-sm text-discret">Aucun crédit sur ce compte.</p> : (
          <ul className="flex flex-col divide-y divide-trait text-sm">
            {d.lots.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-semibold tabular-nums">{l.restant} / {l.quantite}</span> · {ORIGINES[l.origine]}{l.type_reserve ? ` · ${TYPES_EDL[l.type_reserve].toLowerCase()} seulement` : ''} · expire le {jour(l.expire_le)}</span>
                {l.restant > 0 && (aRetirer === l.id
                  ? <button className="font-semibold text-hs underline" onClick={() => { setARetirer(null); void agir(() => appel('admin_annuler_lot', { p_lot: l.id, p_motif: 'Retrait par l’administrateur' }), 'Crédits retirés.'); }}>Confirmer le retrait de {l.restant} crédit{l.restant > 1 ? 's' : ''}</button>
                  : <button className="font-semibold text-marque underline" onClick={() => setARetirer(l.id)}>Retirer le reste</button>)}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={offrir} className="flex flex-col gap-3 border-t border-trait pt-4" noValidate>
          <h3 className="font-sans font-semibold">Offrir des crédits</h3>
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <Champ id="quantite" libelle="Nombre" inputMode="numeric" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            <Liste id="reserve" libelle="Utilisables pour" value={reserve} onChange={(e) => setReserve(e.target.value)}>
              <option value="">Tout état des lieux</option><option value="entrant">Une entrée seulement</option><option value="sortant">Une sortie seulement</option>
            </Liste>
          </div>
          <Champ id="motif" libelle="Motif" value={motif} onChange={(e) => setMotif(e.target.value)} aide="Obligatoire : il est inscrit au journal d’administration." />
          <Bouton type="submit" className="sm:!w-auto sm:self-start sm:px-6">Offrir</Bouton>
        </form>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">États des lieux</h2>
        <p className="text-sm text-discret">Seule la liste est visible ici. Le contenu d’un état des lieux et ses photos restent réservés au compte.</p>
        {d.edl.length === 0 ? <p className="text-sm text-discret">Aucun pour l’instant.</p> : (
          <ul className="flex flex-col divide-y divide-trait text-sm">
            {d.edl.map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><span>{TYPES_EDL[e.type]} · {e.ville} · {jour(e.date)}{e.source === 'signabail' ? ' · bail Signabail' : ''}</span><span className={`font-semibold ${STATUTS_EDL[e.statut].couleur}`}>{STATUTS_EDL[e.statut].libelle}</span></li>)}
          </ul>
        )}
      </Carte>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={o.est_test} onChange={(e) => void agir(() => appel('admin_definir_test', { p_org: o.id, p_test: e.target.checked }), e.target.checked ? 'Compte marqué comme compte de test.' : 'Ce compte n’est plus un compte de test.')} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--marque))]" />
        <span><span className="block font-semibold">Compte de test</span><span className="block text-discret">Exclu des statistiques ; reçoit les messages de test de Signabail.</span></span>
      </label>
    </>
  );
}
