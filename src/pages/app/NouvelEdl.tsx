import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { TYPES_EDL, creerEdl, type EdlLigne, type Logement, type TypeEdl } from '../../lib/edl';
import { local } from '../../lib/local';
import { MODELES_LOGEMENT } from '../../lib/trame';
import { codePostalValide } from '../../lib/validation';

type EntreeDispo = EdlLigne & { logements: { libelle: string } | null };
type Depart = 'nouveau' | 'existant' | 'entree';

const DESCRIPTIONS: Record<TypeEdl, string> = {
  entrant: 'À la remise des clés au locataire.',
  sortant: 'À la restitution des clés, comparé à l’entrée.',
  releve: 'Visite en cours de bail, sans effet sur le dépôt de garantie.',
};

export function NouvelEdl() {
  const { organisation, profil, session } = useAuth();
  const aller = useNavigate();
  const [type, setType] = useState<TypeEdl>('entrant');
  const [depart, setDepart] = useState<Depart>('nouveau');
  const [logements, setLogements] = useState<Logement[]>([]);
  const [entrees, setEntrees] = useState<EntreeDispo[]>([]);
  const [logementId, setLogementId] = useState('');
  const [entreeId, setEntreeId] = useState('');
  const [modeleId, setModeleId] = useState('t2');
  const [libelle, setLibelle] = useState('');
  const [adresse, setAdresse] = useState('');
  const [complement, setComplement] = useState('');
  const [codePostal, setCodePostal] = useState('');
  const [ville, setVille] = useState('');
  const [surface, setSurface] = useState('');
  const [meuble, setMeuble] = useState(false);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (!organisation) return;
    void (async () => {
      await local.tirerListe(organisation.id);
      const lesLogements = (await local.lister<Logement>('logements', 'organisation_id', organisation.id)).sort((a, b) => a.libelle.localeCompare(b.libelle));
      const lesEdl = await local.lister<EdlLigne>('edl', 'organisation_id', organisation.id);
      setLogements(lesLogements);
      setEntrees(
        lesEdl.filter((x) => x.type === 'entrant').sort((a, b) => b.date_edl.localeCompare(a.date_edl))
          .map((x) => ({ ...x, logements: lesLogements.find((l) => l.id === x.logement_id) ?? null })),
      );
    })();
  }, [organisation]);

  // Une sortie part naturellement de l'entrée quand il y en a une.
  useEffect(() => {
    if (type === 'entrant' && depart === 'entree') setDepart('nouveau');
    if (type === 'sortant' && entrees.length) setDepart('entree');
  }, [type, entrees.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!organisation || !profil || !session) return null;
  const modele = MODELES_LOGEMENT.find((m) => m.id === modeleId)!;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    const surfaceNum = surface ? Number(surface.replace(',', '.')) : null;
    let err = '';
    if (depart === 'nouveau') {
      if (!adresse.trim() || !ville.trim()) err = 'Indiquez l’adresse et la ville du logement.';
      else if (!codePostalValide(codePostal)) err = 'Le code postal doit compter 5 chiffres.';
      else if (surfaceNum !== null && !(surfaceNum > 0)) err = 'La surface doit être un nombre positif.';
    } else if (depart === 'existant' && !logementId) err = 'Choisissez un logement.';
    else if (depart === 'entree' && !entreeId) err = 'Choisissez l’état des lieux d’entrée.';
    if (err) return setErreur(err);

    setOccupe(true);
    try {
      const entree = entrees.find((x) => x.id === entreeId);
      const id = await creerEdl({
        organisationId: organisation!.id,
        type,
        realisePar: { id: session!.user.id, nom: [profil!.prenom, profil!.nom].filter(Boolean).join(' ') },
        bailleur: { nom: organisation!.nom, adresse: [organisation!.adresse, organisation!.code_postal, organisation!.ville].filter(Boolean).join(' ') || null },
        ...(depart === 'entree'
          ? { logementId: entree!.logement_id, entreeId }
          : depart === 'existant'
            ? { logementId, modeleId }
            : {
                nouveauLogement: {
                  modeleId,
                  libelle: libelle.trim() || `${modele.label} ${adresse.trim()}`,
                  type_bien: modele.typeBien,
                  adresse: adresse.trim(),
                  complement: complement.trim() || null,
                  code_postal: codePostal.trim(),
                  ville: ville.trim(),
                  surface_m2: surfaceNum,
                  nb_pieces: modele.nbPieces,
                  meuble,
                  a_exterieur: modele.pieces.some((p) => p.type === 'jardin'),
                },
              }),
      });
      aller(`/app/edl/${id}`, { replace: true });
    } catch {
      setOccupe(false);
      setErreur('L’état des lieux d’entrée n’est pas disponible sur cet appareil. Retrouvez du réseau, ouvrez-le une fois, puis recommencez.');
    }
  }

  const choix = 'flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-surface p-3';
  return (
    <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
      <Link to="/app" className="text-sm font-semibold text-marque">← Mes états des lieux</Link>
      <h1 className="text-2xl font-bold">Nouvel état des lieux</h1>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-titre text-lg font-bold">1. Quel état des lieux ?</legend>
        {(Object.keys(TYPES_EDL) as TypeEdl[]).map((t) => (
          <label key={t} className={`${choix} ${type === t ? 'border-marque' : 'border-trait'}`}>
            <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} className="mt-1 h-4 w-4 accent-[rgb(var(--marque))]" />
            <span><span className="block font-semibold">{TYPES_EDL[t]}</span><span className="block text-sm text-discret">{DESCRIPTIONS[t]}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-titre text-lg font-bold">2. D’où partez-vous ?</legend>
        <label className={`${choix} ${depart === 'nouveau' ? 'border-marque' : 'border-trait'}`}>
          <input type="radio" name="depart" checked={depart === 'nouveau'} onChange={() => setDepart('nouveau')} className="mt-1 h-4 w-4 accent-[rgb(var(--marque))]" />
          <span><span className="block font-semibold">Nouveau logement</span><span className="block text-sm text-discret">Choisissez un modèle, les pièces arrivent d’un coup.</span></span>
        </label>
        {logements.length > 0 && (
          <label className={`${choix} ${depart === 'existant' ? 'border-marque' : 'border-trait'}`}>
            <input type="radio" name="depart" checked={depart === 'existant'} onChange={() => setDepart('existant')} className="mt-1 h-4 w-4 accent-[rgb(var(--marque))]" />
            <span><span className="block font-semibold">Un logement déjà enregistré</span><span className="block text-sm text-discret">Sans reprendre un état des lieux précédent.</span></span>
          </label>
        )}
        {type !== 'entrant' && entrees.length > 0 && (
          <label className={`${choix} ${depart === 'entree' ? 'border-marque' : 'border-trait'}`}>
            <input type="radio" name="depart" checked={depart === 'entree'} onChange={() => setDepart('entree')} className="mt-1 h-4 w-4 accent-[rgb(var(--marque))]" />
            <span><span className="block font-semibold">Repartir de l’état des lieux d’entrée</span><span className="block text-sm text-discret">Mêmes pièces, mêmes éléments, mêmes parties.</span></span>
          </label>
        )}
        <div className={`${choix} border-trait opacity-60`}>
          <span className="mt-1 h-4 w-4 rounded-full border border-trait" aria-hidden="true" />
          <span><span className="block font-semibold">Importer un bail Signabail</span><span className="block text-sm text-discret">Bientôt disponible.</span></span>
        </div>
      </fieldset>

      {type === 'sortant' && depart !== 'entree' && (
        <Alerte ton="info">Sans état des lieux d’entrée précis, une retenue sur le dépôt de garantie est très difficile à justifier.</Alerte>
      )}

      {depart === 'entree' && (
        <Liste id="entree" libelle="État des lieux d’entrée" value={entreeId} onChange={(e) => setEntreeId(e.target.value)}>
          <option value="">Choisir…</option>
          {entrees.map((x) => (
            <option key={x.id} value={x.id}>{x.logements?.libelle} — {new Date(x.date_edl).toLocaleDateString('fr-FR')}</option>
          ))}
        </Liste>
      )}
      {depart === 'existant' && (
        <Liste id="logement" libelle="Logement" value={logementId} onChange={(e) => setLogementId(e.target.value)}>
          <option value="">Choisir…</option>
          {logements.map((l) => <option key={l.id} value={l.id}>{l.libelle} — {l.ville}</option>)}
        </Liste>
      )}

      {depart !== 'entree' && (
        <Carte>
          <h2 className="text-lg font-bold">3. {depart === 'nouveau' ? 'Le logement' : 'Les pièces'}</h2>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Modèle de pièces</legend>
            <div className="grid grid-cols-4 gap-2">
              {MODELES_LOGEMENT.map((m) => (
                <label key={m.id} className={`flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border-2 px-1 text-center text-sm font-semibold ${modeleId === m.id ? 'border-marque bg-marque text-sur-marque' : 'border-trait'} ${m.label.length > 7 ? 'col-span-2' : ''}`}>
                  <input type="radio" name="modele" className="sr-only" checked={modeleId === m.id} onChange={() => setModeleId(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-discret">{modele.pieces.length} pièces proposées. Vous pourrez en ajouter ou en retirer.</p>
          </fieldset>
          {depart === 'nouveau' && (
            <>
              <Champ id="adresse" libelle="Adresse" autoComplete="street-address" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
              <Champ id="complement" libelle="Bâtiment, étage, porte" value={complement} onChange={(e) => setComplement(e.target.value)} />
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Champ id="cp" libelle="Code postal" inputMode="numeric" value={codePostal} onChange={(e) => setCodePostal(e.target.value)} />
                <Champ id="ville" libelle="Ville" value={ville} onChange={(e) => setVille(e.target.value)} />
              </div>
              <Champ id="surface" libelle="Surface habitable (m²)" inputMode="decimal" value={surface} onChange={(e) => setSurface(e.target.value)} />
              <Champ id="libelle" libelle="Nom du logement" value={libelle} onChange={(e) => setLibelle(e.target.value)} aide="Facultatif. Pour le retrouver dans votre liste." />
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={meuble} onChange={(e) => setMeuble(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--marque))]" />
                <span><span className="block font-semibold">Logement meublé</span><span className="block text-sm text-discret">L’inventaire du mobilier sera exigé (décret n° 2015-981).</span></span>
              </label>
            </>
          )}
        </Carte>
      )}

      {erreur && <Alerte>{erreur}</Alerte>}
      <Bouton type="submit" variante="repere" occupe={occupe}>Créer le brouillon</Bouton>
      <p className="text-center text-sm text-discret">Le brouillon est gratuit et se reprend à tout moment.</p>
    </form>
  );
}
