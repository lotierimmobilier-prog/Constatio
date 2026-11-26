import { useEffect, useRef, useState } from 'react';
import { adressePhoto, ajouterPhotos, heurePhoto, lieuPhoto, retirerPhoto, type Cible, type Photo } from '../lib/photos';
import { local } from '../lib/local';
import { Rafale } from './Rafale';
import { Alerte } from './ui';

function Vignette({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const [adresse, setAdresse] = useState<string | null>(null);
  const [absente, setAbsente] = useState(false);
  useEffect(() => {
    let actif = true;
    void adressePhoto(photo).then((a) => { if (actif) { setAdresse(a); setAbsente(!a); } });
    return () => { actif = false; };
  }, [photo]);
  return (
    <button type="button" onClick={onClick} aria-label={`Photo du ${heurePhoto(photo)}${photo.legende ? ` : ${photo.legende}` : ''}`}
      className="relative aspect-square overflow-hidden rounded-xl border border-trait bg-creux">
      {adresse && <img src={adresse} alt="" className="h-full w-full object-cover" onError={() => setAbsente(true)} />}
      {absente && <span className="absolute inset-0 grid place-items-center p-1 text-center text-xs text-discret">Visible au retour du réseau</span>}
    </button>
  );
}

/**
 * Les photos d'un élément, d'un compteur ou de l'état des lieux : vignettes,
 * ajout depuis l'appareil photo, et une visionneuse avec date, lieu et légende.
 */
export function Photos({ edl, cible, photos, quoi, verrouille, onChange }: {
  edl: { id: string; organisation_id: string };
  cible: Cible;
  photos: Photo[];
  quoi: string;
  verrouille: boolean;
  onChange: (photos: Photo[]) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const [occupe, setOccupe] = useState(false);
  const [illisibles, setIllisibles] = useState(0);
  const [ouverte, setOuverte] = useState<Photo | null>(null);
  const [adresse, setAdresse] = useState<string | null>(null);
  const [aRetirer, setARetirer] = useState(false);
  const [rafale, setRafale] = useState(false);
  // En rafale, les photos arrivent une à une pendant que la liste change : on garde la dernière connue.
  const courantes = useRef(photos);
  courantes.current = photos;
  async function ajouterUne(fichier: File) {
    const r = await ajouterPhotos(edl, cible, [fichier], quoi);
    courantes.current = [...courantes.current, ...r.ajoutees];
    onChange(courantes.current);
  }

  useEffect(() => {
    setAdresse(null);
    setARetirer(false);
    if (ouverte) void adressePhoto(ouverte).then(setAdresse);
  }, [ouverte]);

  async function choisir(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setOccupe(true);
    const r = await ajouterPhotos(edl, cible, [...fichiers], quoi);
    setIllisibles(r.illisibles);
    onChange([...photos, ...r.ajoutees]);
    setOccupe(false);
    if (champ.current) champ.current.value = '';
  }

  return (
    <div className="flex flex-col gap-2" data-testid="photos">
      <div className="grid grid-cols-4 gap-2">
        {photos.map((p) => <Vignette key={p.id} photo={p} onClick={() => setOuverte(p)} />)}
        {!verrouille && (
          <label className={`grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-marque p-1 text-center text-sm font-semibold text-marque ${occupe ? 'opacity-50' : ''}`}>
            {/* « capture » ouvre directement l'appareil photo du téléphone ; plusieurs fichiers restent possibles depuis la galerie. */}
            <input ref={champ} type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={occupe} onChange={(e) => choisir(e.target.files)} />
            {occupe ? 'Un instant…' : photos.length ? '+ Photo' : 'Prendre une photo'}
          </label>
        )}
      </div>
      {!verrouille && (
        <button type="button" onClick={() => setRafale(true)} className="self-start text-sm font-semibold text-marque underline underline-offset-4" data-testid="ouvrir-rafale">Plusieurs photos à la suite (rafale)</button>
      )}
      {rafale && <Rafale titre={quoi} onPhoto={ajouterUne} onFermer={() => setRafale(false)} />}
      {illisibles > 0 && <Alerte>{illisibles > 1 ? `${illisibles} fichiers n’ont pas pu être lus` : 'Un fichier n’a pas pu être lu'} : ce n’est pas une image, ou son format n’est pas pris en charge par ce téléphone.</Alerte>}

      {ouverte && (
        <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-20 flex flex-col bg-encre/95 text-fond">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 text-sm">
              <span className="block font-semibold">{quoi}</span>
              <span className="block opacity-80">Prise le {heurePhoto(ouverte)}{lieuPhoto(ouverte) ? ` · ${lieuPhoto(ouverte)}` : ' · position non enregistrée'}</span>
            </p>
            <button type="button" onClick={() => setOuverte(null)} className="min-h-[44px] rounded-xl border-2 border-fond px-4 font-semibold">Fermer</button>
          </div>
          {/* L'image occupe la place restante, sans jamais recouvrir la légende ni les boutons. */}
          <div className="relative min-h-0 flex-1">
            {adresse ? <img src={adresse} alt={ouverte.legende ?? ''} className="absolute inset-0 h-full w-full object-contain" /> : <p className="absolute inset-0 grid place-items-center opacity-80">Visible au retour du réseau</p>}
          </div>
          <div className="flex flex-col gap-2 px-4 py-3">
            <label htmlFor="legende" className="text-sm font-semibold">Légende</label>
            <input id="legende" key={ouverte.id} disabled={verrouille} defaultValue={ouverte.legende ?? ''} placeholder="Rayure près de la fenêtre…"
              className="min-h-[48px] rounded-xl border border-fond/40 bg-transparent px-3 text-base placeholder:opacity-60"
              onBlur={async (e) => {
                const v = e.target.value.trim() || null;
                if (v === ouverte.legende) return;
                await local.modifier('edl_photos', ouverte.id, { legende: v }, `Photo, ${quoi}`);
                const maj = { ...ouverte, legende: v };
                setOuverte(maj);
                onChange(photos.map((p) => (p.id === maj.id ? maj : p)));
              }} />
            {!verrouille && (
              <button type="button" className="min-h-[44px] self-start font-semibold underline underline-offset-4"
                onClick={async () => {
                  // Un second appui confirme : une photo retirée ne se récupère pas.
                  if (!aRetirer) return setARetirer(true);
                  await retirerPhoto(ouverte, quoi);
                  onChange(photos.filter((p) => p.id !== ouverte.id));
                  setOuverte(null);
                }}>
                {aRetirer ? 'Confirmer : retirer définitivement cette photo' : 'Retirer cette photo'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
