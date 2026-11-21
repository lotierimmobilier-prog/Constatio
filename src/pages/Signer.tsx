import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PadSignature } from '../components/PadSignature';
import { Alerte, Carte, Logo, classesBouton } from '../components/ui';
import { demander, messageSignature } from '../lib/signature';

interface Dossier {
  essai: boolean;
  edl: { type: 'entrant' | 'sortant' | 'releve'; statut: string; date_edl: string; adresse: string; pdf_sha256: string };
  document: string | null;
  moi: { qualite: string; nom: string; signe_le: string | null };
  signataires: { qualite: string; nom: string; signe: boolean }[];
}
const TITRES = { entrant: 'État des lieux d’entrée', sortant: 'État des lieux de sortie', releve: 'Relevé d’état du logement' };
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Page ouverte par le lien personnel de signature à distance : sans compte, sans mot de passe. */
export function Signer() {
  const { jeton } = useParams();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lu, setLu] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const r = await demander({ action: 'consulter', jeton });
    if (r.statut !== 'ok') return setErreur(messageSignature(r));
    setDossier(r as unknown as Dossier);
  }, [jeton]);
  useEffect(() => { void charger(); }, [charger]);

  async function signer(image: string) {
    setOccupe(true); setErreur(null);
    const r = await demander({ action: 'signer_lien', jeton, image, lu: true });
    setOccupe(false);
    if (r.statut !== 'ok') return setErreur(messageSignature(r));
    await charger();
  }

  const adresseDocument = dossier?.document ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1${dossier.document}` : null;
  return (
    <div className="min-h-dvh bg-fond">
      {dossier?.essai && <div className="bg-repere px-4 py-1 text-center text-xs font-semibold text-sur-repere">Mode test : cette signature est une démonstration, sans valeur.</div>}
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <Logo />
        {erreur && <Alerte>{erreur}</Alerte>}
        {!dossier && !erreur && <p className="text-center text-discret">Chargement…</p>}
        {dossier && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{TITRES[dossier.edl.type]}</h1>
              <p className="text-sm text-discret">{dossier.edl.adresse} · établi le {jour(dossier.edl.date_edl)}</p>
            </div>
            <Carte>
              <p className="text-sm text-discret">{dossier.moi.qualite}</p>
              <p className="text-lg font-bold" data-testid="signataire">{dossier.moi.nom}</p>
              {adresseDocument && <a href={adresseDocument} target="_blank" rel="noreferrer" className={classesBouton(dossier.moi.signe_le ? 'repere' : 'contour')} data-testid="lire-document">{dossier.edl.statut === 'signe' ? 'Ouvrir l’exemplaire signé' : 'Lire le document'}</a>}
              {dossier.moi.signe_le ? (
                <Alerte ton="succes">
                  Vous avez signé le {new Date(dossier.moi.signe_le).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.{' '}
                  {dossier.edl.statut === 'signe' ? 'Toutes les parties ont signé : conservez votre exemplaire.' : 'L’exemplaire signé sera disponible ici, par ce même lien, dès que toutes les parties auront signé.'}
                </Alerte>
              ) : (
                <>
                  <p className="text-sm">Lisez le document en entier. Si un point ne correspond pas à ce que vous avez constaté, ne signez pas : demandez sa correction à la personne qui vous a transmis ce lien.</p>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={lu} onChange={(e) => setLu(e.target.checked)} />
                    <span>Je soussigné(e) {dossier.moi.nom} ai lu l’état des lieux et l’approuve.</span>
                  </label>
                  {lu && <PadSignature occupe={occupe} onValider={signer} />}
                </>
              )}
            </Carte>
            <Carte>
              <h2 className="font-bold">Signataires</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {dossier.signataires.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{s.qualite} — {s.nom}</span><span className={`font-semibold ${s.signe ? 'text-neuf' : 'text-discret'}`}>{s.signe ? 'Signé' : 'En attente'}</span></li>
                ))}
              </ul>
              <p className="break-all text-xs text-discret">Empreinte du document (SHA-256) : {dossier.edl.pdf_sha256}</p>
            </Carte>
          </>
        )}
      </main>
    </div>
  );
}
