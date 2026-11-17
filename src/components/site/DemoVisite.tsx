import { useState } from 'react';
import { ETATS, type Etat } from '../../lib/trame';

interface Ligne { id: string; libelle: string; nature: string; etat: Etat | null; observation: string }
const DEPART: Ligne[] = [
  { id: 'sol', libelle: 'Sol', nature: 'parquet stratifié', etat: 'bon', observation: '' },
  { id: 'murs', libelle: 'Murs', nature: 'peinture blanche', etat: 'usage', observation: '' },
  { id: 'fenetre', libelle: 'Fenêtre', nature: 'PVC, volet roulant', etat: 'hors_service', observation: '' },
  { id: 'prises', libelle: 'Prises, interrupteurs', nature: '', etat: null, observation: '' },
];

/** La visite d'une pièce, en vrai : mêmes boutons et mêmes contrôles que dans l'application. */
export function DemoVisite() {
  const [lignes, setLignes] = useState(DEPART);
  const changer = (id: string, champs: Partial<Ligne>) => setLignes((l) => l.map((x) => (x.id === id ? { ...x, ...champs } : x)));
  const sansEtat = lignes.filter((l) => l.etat === null);
  const muets = lignes.filter((l) => (l.etat === 'mauvais' || l.etat === 'hors_service') && !l.observation.trim());

  return (
    <div className="mx-auto w-full max-w-[22rem] overflow-hidden rounded-[2rem] border-2 border-encre bg-fond shadow-[0_24px_60px_-30px_rgb(var(--encre)/0.5)]">
      <div className="flex items-center justify-between bg-marque px-4 py-3 text-sm font-semibold text-sur-marque">
        <span>Séjour</span>
        <span className="font-normal opacity-80">pièce 2 / 5</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {lignes.map((l) => (
          <div key={l.id} className="rounded-2xl border border-trait bg-surface p-3">
            <p className="text-sm font-semibold">{l.libelle}{l.nature && <span className="font-normal text-discret"> · {l.nature}</span>}</p>
            <div role="group" aria-label={`État : ${l.libelle}`} className="mt-2 grid grid-cols-5 gap-1.5">
              {ETATS.map((x) => {
                const actif = l.etat === x.id;
                return (
                  <button key={x.id} type="button" aria-pressed={actif} aria-label={x.label} title={x.label} onClick={() => changer(l.id, { etat: actif ? null : x.id })}
                    className={`min-h-[40px] rounded-lg border-2 text-xs font-bold transition ${actif ? `${x.classe} border-transparent text-surface` : 'border-trait text-discret hover:border-discret'}`}>
                    {x.court}
                  </button>
                );
              })}
            </div>
            {(l.etat === 'mauvais' || l.etat === 'hors_service') && (
              <input aria-label={`Observation : ${l.libelle}`} value={l.observation} onChange={(e) => changer(l.id, { observation: e.target.value })}
                placeholder="Décrivez le défaut…" className="mt-2 min-h-[40px] w-full rounded-lg border border-trait bg-fond px-2 text-sm placeholder:text-discret" />
            )}
          </div>
        ))}
        <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
          {sansEtat.length > 0 && <p className="rounded-r-lg border-l-4 border-mauvais bg-surface px-3 py-1.5">{sansEtat.length} élément{sansEtat.length > 1 ? 's' : ''} sans état.</p>}
          {muets.map((l) => (
            <p key={l.id} className="rounded-r-lg border-l-4 border-repere bg-surface px-3 py-1.5">{l.libelle} en mauvais état sans observation : décrivez le défaut.</p>
          ))}
          {sansEtat.length === 0 && muets.length === 0 && <p className="rounded-r-lg border-l-4 border-neuf bg-surface px-3 py-1.5 font-semibold">Pièce complète.</p>}
        </div>
      </div>
    </div>
  );
}
