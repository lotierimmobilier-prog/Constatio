import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnteteEdl, useVerrou } from '../../components/EnteteEdl';
import { Alerte, Bouton, Carte, Champ, Liste, classesBouton } from '../../components/ui';
import { supabase } from '../../lib/supabase';

type Nature = 'cle' | 'badge' | 'bip' | 'telecommande' | 'carte' | 'autre';
interface Cle { id: string; nature: Nature; nombre: number; destination: string; ordre: number }
const NATURES: Record<Nature, string> = { cle: 'Clé', badge: 'Badge', bip: 'Bip', telecommande: 'Télécommande', carte: 'Carte', autre: 'Autre' };
// Les trousseaux les plus courants, pour ajouter d'un geste.
const COURANTS: { nature: Nature; destination: string }[] = [
  { nature: 'cle', destination: 'Porte d’entrée du logement' },
  { nature: 'cle', destination: 'Porte de l’immeuble' },
  { nature: 'cle', destination: 'Boîte aux lettres' },
  { nature: 'badge', destination: 'Accès immeuble' },
  { nature: 'telecommande', destination: 'Parking ou portail' },
  { nature: 'cle', destination: 'Cave' },
];

/** Détail et destination des clés et de tout autre moyen d'accès (décret n° 2016-382, art. 2). */
export function EdlCles() {
  const { id, verrouille } = useVerrou();
  const [cles, setCles] = useState<Cle[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const minuteurs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const charger = useCallback(async () => {
    const { data } = await supabase.from('edl_cles').select('id, nature, nombre, destination, ordre').eq('edl_id', id).order('ordre').order('created_at');
    setCles((data as Cle[]) ?? []);
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  if (!cles) return <p className="text-center text-discret">Chargement…</p>;

  async function ajouter(nature: Nature, destination: string) {
    const ligne = { id: crypto.randomUUID(), edl_id: id, nature, nombre: 1, destination, ordre: cles!.length ? Math.max(...cles!.map((c) => c.ordre)) + 1 : 0 };
    const { error } = await supabase.from('edl_cles').insert(ligne);
    if (error) return setErreur(true);
    setCles([...cles!, ligne]);
  }
  async function modifier(cleId: string, champs: Partial<Cle>) {
    setErreur(false);
    setCles((l) => l!.map((c) => (c.id === cleId ? { ...c, ...champs } : c)));
    const { data, error } = await supabase.from('edl_cles').update(champs).eq('id', cleId).select('id');
    if (error || !data?.length) { setErreur(true); await charger(); }
  }
  // La destination s'enregistre peu après la dernière frappe, sans attendre que
  // l'on quitte le champ : sur téléphone, on passe souvent à l'écran suivant sans le faire.
  function saisirDestination(cleId: string, destination: string) {
    setCles((l) => l!.map((c) => (c.id === cleId ? { ...c, destination } : c)));
    clearTimeout(minuteurs.current.get(cleId));
    minuteurs.current.set(cleId, setTimeout(() => void modifier(cleId, { destination: destination.trim() }), 500));
  }
  async function retirer(cleId: string) {
    const { error } = await supabase.from('edl_cles').delete().eq('id', cleId);
    if (error) setErreur(true); else setCles((l) => l!.filter((c) => c.id !== cleId));
  }

  const total = cles.reduce((s, c) => s + c.nombre, 0);
  const restants = COURANTS.filter((x) => !cles.some((c) => c.destination === x.destination));

  return (
    <>
      <EnteteEdl id={id} titre="Clés et accès" intro="Notez chaque clé, badge ou télécommande remis au locataire, avec ce qu’il ouvre. C’est ce qui sera réclamé à la sortie." verrouille={verrouille} />
      {erreur && <Alerte>La dernière modification n’a pas été enregistrée. Vérifiez votre connexion et recommencez.</Alerte>}
      <p className="text-sm font-semibold" data-testid="total-cles">{total} élément{total > 1 ? 's' : ''} remis</p>

      {cles.map((c) => (
        <Carte key={c.id} className="!gap-3">
          <fieldset disabled={verrouille} className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Liste id={`nature-${c.id}`} libelle="Nature" value={c.nature} onChange={(e) => modifier(c.id, { nature: e.target.value as Nature })}>
                {(Object.keys(NATURES) as Nature[]).map((n) => <option key={n} value={n}>{NATURES[n]}</option>)}
              </Liste>
              <div className="flex items-center gap-2" role="group" aria-label={`Nombre : ${c.destination}`}>
                <button type="button" aria-label="Un de moins" disabled={c.nombre <= 1} onClick={() => modifier(c.id, { nombre: c.nombre - 1 })} className="h-12 w-12 rounded-xl border-2 border-trait text-xl font-bold disabled:opacity-40">−</button>
                <span className="w-8 text-center font-titre text-xl font-bold tabular-nums" data-testid="nombre">{c.nombre}</span>
                <button type="button" aria-label="Un de plus" onClick={() => modifier(c.id, { nombre: c.nombre + 1 })} className="h-12 w-12 rounded-xl border-2 border-trait text-xl font-bold">+</button>
              </div>
            </div>
            <Champ id={`dest-${c.id}`} libelle="Ce qu’il ouvre" value={c.destination} onChange={(e) => saisirDestination(c.id, e.target.value)} />
            <button type="button" className="self-start text-sm font-semibold text-hs underline-offset-4 hover:underline" onClick={() => retirer(c.id)}>Retirer</button>
          </fieldset>
        </Carte>
      ))}

      {!verrouille && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Ajouter</p>
          <div className="flex flex-wrap gap-2">
            {restants.map((x) => (
              <button key={x.destination} type="button" onClick={() => ajouter(x.nature, x.destination)} className="min-h-[44px] rounded-full border-2 border-marque px-3 text-sm font-semibold text-marque">
                + {x.destination}
              </button>
            ))}
          </div>
          <Bouton variante="contour" onClick={() => ajouter('cle', '')}>Autre clé ou accès</Bouton>
        </div>
      )}
      <Link to={`/app/edl/${id}/controles`} className={classesBouton('plein')}>Continuer : contrôles</Link>
    </>
  );
}
