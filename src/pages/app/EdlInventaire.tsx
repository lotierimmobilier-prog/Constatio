import { useCallback, useEffect, useState } from 'react';
import { EnteteEdl, useVerrou } from '../../components/EnteteEdl';
import { Alerte, Bouton, Champ } from '../../components/ui';
import { MOBILIER_DECRET } from '../../lib/controles';
import { supabase } from '../../lib/supabase';
import { ETATS, type Etat } from '../../lib/trame';

interface Ligne { id: string; code_decret: string | null; libelle: string; quantite: number; etat: Etat | null; observations: string | null; ordre: number }

/** Inventaire du mobilier d'un meublé : la liste minimale du décret d'abord, le reste ensuite. */
export function EdlInventaire() {
  const { id, verrouille } = useVerrou();
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [nouveau, setNouveau] = useState('');
  const [erreur, setErreur] = useState(false);

  const charger = useCallback(async () => {
    const { data } = await supabase.from('edl_inventaire').select('id, code_decret, libelle, quantite, etat, observations, ordre').eq('edl_id', id).order('ordre').order('created_at');
    setLignes((data as Ligne[]) ?? []);
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  if (!lignes) return <p className="text-center text-discret">Chargement…</p>;

  async function ajouter(libelle: string, code: string | null) {
    const ligne: Ligne = { id: crypto.randomUUID(), code_decret: code, libelle, quantite: 1, etat: null, observations: null, ordre: lignes!.length ? Math.max(...lignes!.map((l) => l.ordre)) + 1 : 0 };
    const { error } = await supabase.from('edl_inventaire').insert({ ...ligne, edl_id: id });
    if (error) return setErreur(true);
    setLignes([...lignes!, ligne]);
  }
  async function modifier(ligneId: string, champs: Partial<Ligne>) {
    setErreur(false);
    setLignes((l) => l!.map((x) => (x.id === ligneId ? { ...x, ...champs } : x)));
    const { data, error } = await supabase.from('edl_inventaire').update(champs).eq('id', ligneId).select('id');
    if (error || !data?.length) { setErreur(true); await charger(); }
  }
  async function retirer(ligneId: string) {
    const { error } = await supabase.from('edl_inventaire').delete().eq('id', ligneId);
    if (error) setErreur(true); else setLignes((l) => l!.filter((x) => x.id !== ligneId));
  }

  const manquants = MOBILIER_DECRET.filter((m) => !lignes.some((l) => l.code_decret === m.code));
  const fiche = (l: Ligne) => (
    <li key={l.id} className="flex flex-col gap-2 rounded-2xl border border-trait bg-surface p-3" data-testid={`mobilier-${l.code_decret ?? 'libre'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 font-semibold">{l.libelle}</span>
        <span className="flex items-center gap-1" role="group" aria-label={`Quantité : ${l.libelle}`}>
          <button type="button" aria-label="Un de moins" disabled={verrouille || l.quantite <= 1} onClick={() => modifier(l.id, { quantite: l.quantite - 1 })} className="h-11 w-11 rounded-xl border-2 border-trait text-lg font-bold disabled:opacity-40">−</button>
          <span className="w-7 text-center font-bold tabular-nums">{l.quantite}</span>
          <button type="button" aria-label="Un de plus" disabled={verrouille} onClick={() => modifier(l.id, { quantite: l.quantite + 1 })} className="h-11 w-11 rounded-xl border-2 border-trait text-lg font-bold">+</button>
        </span>
      </div>
      <div role="group" aria-label={`État : ${l.libelle}`} className="grid grid-cols-5 gap-1.5">
        {ETATS.map((x) => {
          const actif = l.etat === x.id;
          return (
            <button key={x.id} type="button" disabled={verrouille} aria-pressed={actif} aria-label={x.label} title={x.label} onClick={() => modifier(l.id, { etat: actif ? null : x.id })}
              className={`min-h-[44px] rounded-xl border-2 text-sm font-bold ${actif ? `${x.classe} border-transparent text-surface` : 'border-trait text-discret'}`}>{x.court}</button>
          );
        })}
      </div>
      {!verrouille && <button type="button" className="self-start text-sm font-semibold text-hs underline-offset-4 hover:underline" onClick={() => retirer(l.id)}>{l.code_decret ? 'Absent du logement' : 'Retirer'}</button>}
    </li>
  );

  return (
    <>
      <EnteteEdl id={id} titre="Inventaire du mobilier" intro="Un logement loué meublé doit comporter au moins onze équipements (décret n° 2015-981). S’il en manque un, le bail peut être requalifié en location vide." verrouille={verrouille} />
      {erreur && <Alerte>La dernière modification n’a pas été enregistrée. Vérifiez votre connexion et recommencez.</Alerte>}

      <h2 className="text-lg font-bold">Équipements obligatoires</h2>
      <p className="text-sm" data-testid="decompte-decret">
        {manquants.length === 0 ? <span className="font-semibold text-neuf">Les 11 équipements sont présents.</span> : <span className="font-semibold text-mauvais">{MOBILIER_DECRET.length - manquants.length} sur 11 présents.</span>}
      </p>
      <ul className="flex flex-col gap-2">{lignes.filter((l) => l.code_decret).map(fiche)}</ul>
      {!verrouille && manquants.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-discret">Touchez ce qui est présent dans le logement :</p>
          {manquants.map((m) => (
            <button key={m.code} type="button" onClick={() => ajouter(m.libelle, m.code)} className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl border-2 border-dashed border-trait px-3 text-left">
              <span>{m.libelle}</span><span className="whitespace-nowrap text-sm font-semibold text-marque">Présent</span>
            </button>
          ))}
          {manquants.length > 1 && <Bouton variante="contour" onClick={async () => { for (const m of manquants) await ajouter(m.libelle, m.code); await charger(); }}>Tout est présent</Bouton>}
        </div>
      )}

      <h2 className="mt-2 text-lg font-bold">Autres meubles et équipements</h2>
      <ul className="flex flex-col gap-2">{lignes.filter((l) => !l.code_decret).map(fiche)}</ul>
      {!verrouille && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (nouveau.trim()) { void ajouter(nouveau.trim(), null); setNouveau(''); } }}>
          <div className="flex-1"><Champ id="nouveau-meuble" libelle="Ajouter" value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder="Canapé, lave-linge, télévision…" /></div>
          <Bouton type="submit" variante="contour" className="!w-auto" disabled={!nouveau.trim()}>Ajouter</Bouton>
        </form>
      )}
    </>
  );
}
