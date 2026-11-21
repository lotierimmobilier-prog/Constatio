import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnteteEdl, useVerrou } from '../../components/EnteteEdl';
import { Photos } from '../../components/Photos';
import { Alerte, Carte, Champ, classesBouton } from '../../components/ui';
import { chargerEdl } from '../../lib/edl';
import type { Photo } from '../../lib/photos';
import { COMPTEURS, type TypeCompteur } from '../../lib/controles';
import { lireIndex } from '../../lib/edl';
import { local } from '../../lib/local';

interface Ligne {
  absent: boolean;
  numero: string;
  double_tarif: boolean;
  index_1: string;
  index_2: string;
  emplacement: string;
}
const vide = (): Ligne => ({ absent: false, numero: '', double_tarif: false, index_1: '', index_2: '', emplacement: '' });
const ABSENCE: Record<TypeCompteur, string> = {
  electricite: 'Pas de compteur individuel',
  eau_froide: 'Pas de compteur individuel',
  eau_chaude: 'Pas de compteur d’eau chaude (ballon ou chaudière individuels, ou collectif sans comptage)',
  gaz: 'Pas de gaz dans le logement',
};
const fr = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/** Relevés des compteurs : chacun est relevé ou déclaré absent, jamais laissé vide. */
export function EdlCompteurs() {
  const { id, verrouille } = useVerrou();
  const [lignes, setLignes] = useState<Record<TypeCompteur, Ligne> | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [organisationId, setOrganisationId] = useState('');
  const [etat, setEtat] = useState<Partial<Record<TypeCompteur, 'ok' | 'saisie'>>>({});

  useEffect(() => {
    void (async () => {
      const fiche = await chargerEdl(id);
      setOrganisationId(fiche?.edl.organisation_id ?? '');
      setPhotos((await local.lister<Photo>('edl_photos', 'edl_id', id)).filter((p) => p.compteur_type));
      const data = await local.lister<{ type: TypeCompteur; absent: boolean; numero: string | null; double_tarif: boolean; index_1: number | null; index_2: number | null; emplacement: string | null }>('edl_compteurs', 'edl_id', id);
      const depart = Object.fromEntries(COMPTEURS.map((c) => [c.type, vide()])) as Record<TypeCompteur, Ligne>;
      for (const c of data)
        depart[c.type] = { absent: c.absent, numero: c.numero ?? '', double_tarif: c.double_tarif, index_1: fr(c.index_1), index_2: fr(c.index_2), emplacement: c.emplacement ?? '' };
      setLignes(depart);
    })();
  }, [id]);

  if (!lignes) return <p className="text-center text-discret">Chargement…</p>;

  /** Enregistre un compteur entier : une seule ligne par énergie, créée au premier passage. */
  async function enregistrer(type: TypeCompteur, l: Ligne) {
    const i1 = l.absent ? null : lireIndex(l.index_1);
    const i2 = l.absent || !l.double_tarif ? null : lireIndex(l.index_2);
    if (Number.isNaN(i1) || Number.isNaN(i2)) return setEtat((s) => ({ ...s, [type]: 'saisie' }));
    await local.poser(
      'edl_compteurs',
      { edl_id: id, type },
      { absent: l.absent, numero: l.absent ? null : l.numero.trim() || null, double_tarif: !l.absent && l.double_tarif, index_1: i1, index_2: i2, emplacement: l.emplacement.trim() || null },
      `Compteur ${COMPTEURS.find((c) => c.type === type)!.libelle.toLowerCase()}`,
    );
    setEtat((s) => ({ ...s, [type]: 'ok' }));
  }
  const changer = (type: TypeCompteur, champs: Partial<Ligne>, sauver = false) => {
    const suivant = { ...lignes![type], ...champs };
    setLignes({ ...lignes!, [type]: suivant });
    if (sauver) void enregistrer(type, suivant);
  };

  return (
    <>
      <EnteteEdl id={id} titre="Compteurs" intro="Relevez l’index affiché, sans les chiffres après la virgule s’ils sont en rouge. Un compteur absent se déclare, il ne se laisse pas vide." verrouille={verrouille} />
      {COMPTEURS.map((c) => {
        const l = lignes[c.type];
        const k = c.type;
        return (
          <Carte key={k}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{c.libelle}</h2>
              <span className="text-sm font-semibold" data-testid={`etat-${k}`}>
                {etat[k] === 'ok' && <span className="text-neuf">Enregistré</span>}
              </span>
            </div>
            <fieldset disabled={verrouille} className="flex flex-col gap-3">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={l.absent} onChange={(e) => changer(k, { absent: e.target.checked }, true)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--marque))]" />
                <span>{ABSENCE[k]}</span>
              </label>
              {!l.absent && (
                <>
                  {k === 'electricite' && (
                    <label className="flex items-start gap-3 text-sm">
                      <input type="checkbox" checked={l.double_tarif} onChange={(e) => changer(k, { double_tarif: e.target.checked }, true)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--marque))]" />
                      <span>Double tarif : heures pleines et heures creuses</span>
                    </label>
                  )}
                  <div className={l.double_tarif ? 'grid grid-cols-2 gap-3' : ''}>
                    <Champ id={`i1-${k}`} libelle={l.double_tarif ? `Heures pleines (${c.unite})` : `Index (${c.unite})`} inputMode="decimal" className="font-mono" value={l.index_1}
                      onChange={(e) => changer(k, { index_1: e.target.value })} onBlur={() => enregistrer(k, l)} />
                    {l.double_tarif && (
                      <Champ id={`i2-${k}`} libelle={`Heures creuses (${c.unite})`} inputMode="decimal" value={l.index_2}
                        onChange={(e) => changer(k, { index_2: e.target.value })} onBlur={() => enregistrer(k, l)} />
                    )}
                  </div>
                  <Champ id={`num-${k}`} libelle="Numéro du compteur" value={l.numero} onChange={(e) => changer(k, { numero: e.target.value })} onBlur={() => enregistrer(k, l)}
                    aide={k === 'electricite' ? 'Ou le point de livraison (PDL, 14 chiffres).' : k === 'gaz' ? 'Ou le point de comptage (PCE).' : undefined} />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">Photo du compteur</span>
                    <Photos edl={{ id, organisation_id: organisationId }} cible={{ compteur_type: k }} photos={photos.filter((p) => p.compteur_type === k)} quoi={`compteur ${c.libelle.toLowerCase()}`} verrouille={verrouille}
                      onChange={(suite) => setPhotos((toutes) => [...toutes.filter((p) => p.compteur_type !== k), ...suite])} />
                  </div>
                  <Champ id={`emp-${k}`} libelle="Emplacement" value={l.emplacement} onChange={(e) => changer(k, { emplacement: e.target.value })} onBlur={() => enregistrer(k, l)} placeholder="Palier, placard de l’entrée…" />
                </>
              )}
            </fieldset>
            {etat[k] === 'saisie' && <Alerte>L’index doit être un nombre, par exemple 18432 ou 214,5.</Alerte>}
          </Carte>
        );
      })}
      <Link to={`/app/edl/${id}/cles`} className={classesBouton('plein')}>Continuer : remise des clés</Link>
    </>
  );
}
