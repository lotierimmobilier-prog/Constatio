import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type TypeCompte } from '../../auth/AuthProvider';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { traduireErreur } from '../../lib/erreurs';
import { useSync } from '../../lib/local';
import { supabase } from '../../lib/supabase';
import { LONGUEUR_MOT_DE_PASSE, codePostalValide, emailValide, motDePasseValide, siretValide } from '../../lib/validation';

type Retour = { ton: 'succes' | 'erreur'; texte: string } | null;
const ROLES = { proprietaire: 'Propriétaire du compte', admin: 'Administrateur', agent: 'Agent' } as const;

export function Compte() {
  const { session, profil, organisation, role, recharger, deconnecter } = useAuth();
  const aller = useNavigate();
  const { enAttente, enLigne } = useSync();
  const [confirmer, setConfirmer] = useState(false);
  const [admin, setAdmin] = useState(false);
  useEffect(() => { supabase.rpc('admin_moi').then(({ data }) => setAdmin(!!data)); }, []);
  if (!profil || !organisation) return null;
  const peutGerer = role === 'proprietaire' || role === 'admin';

  return (
    <>
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <p className="text-sm text-discret">
        {session?.user.email} · {role ? ROLES[role] : ''}
      </p>
      {admin && <Link to="/admin" className="font-semibold text-marque underline underline-offset-4">Ouvrir l’administration de Constatio</Link>}
      <FormulaireProfil key={profil.id} recharger={recharger} />
      <FormulaireOrganisation key={organisation.id} lectureSeule={!peutGerer} recharger={recharger} />
      <Presentation key={`p-${organisation.id}`} lectureSeule={!peutGerer} recharger={recharger} />
      <FormulaireMotDePasse />
      {!enLigne && <Alerte ton="info">Hors connexion : les modifications du compte seront possibles au retour du réseau.</Alerte>}
      {confirmer && (
        <Alerte>
          {enAttente} modification{enAttente > 1 ? 's' : ''} faite{enAttente > 1 ? 's' : ''} hors connexion {enAttente > 1 ? 'ne sont' : 'n’est'} pas encore envoyée{enAttente > 1 ? 's' : ''}. Si vous vous déconnectez maintenant, {enAttente > 1 ? 'elles seront perdues' : 'elle sera perdue'}.
        </Alerte>
      )}
      <Bouton
        variante="contour"
        onClick={async () => {
          // Se déconnecter efface la copie locale : on prévient s'il reste des saisies non envoyées.
          if (enAttente > 0 && !confirmer) return setConfirmer(true);
          await deconnecter();
          aller('/', { replace: true });
        }}
      >
        {confirmer ? 'Me déconnecter quand même' : 'Se déconnecter'}
      </Bouton>
    </>
  );
}

function FormulaireProfil({ recharger }: { recharger: () => Promise<void> }) {
  const { profil, session } = useAuth();
  const actuel = session?.user.email ?? '';
  const [email, setEmail] = useState(actuel);
  const [prenom, setPrenom] = useState(profil!.prenom);
  const [nom, setNom] = useState(profil!.nom);
  const [telephone, setTelephone] = useState(profil!.telephone ?? '');
  const [retour, setRetour] = useState<Retour>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return setRetour({ ton: 'erreur', texte: 'Indiquez votre nom.' });
    const nouvelle = email.trim().toLowerCase();
    if (!emailValide(nouvelle)) return setRetour({ ton: 'erreur', texte: 'Cette adresse e-mail n’est pas valide.' });
    setOccupe(true);
    const { error } = await supabase
      .from('profils')
      .update({ prenom: prenom.trim(), nom: nom.trim(), telephone: telephone.trim() || null })
      .eq('id', profil!.id);
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    await recharger();
    // L'adresse sert à se connecter : elle ne change qu'une fois confirmée depuis la nouvelle boîte.
    if (nouvelle !== actuel.toLowerCase()) {
      const changement = await supabase.auth.updateUser({ email: nouvelle }, { emailRedirectTo: `${window.location.origin}/app/compte` });
      if (changement.error) return setRetour({ ton: 'erreur', texte: `Coordonnées enregistrées, mais l’adresse e-mail n’a pas pu être changée : ${traduireErreur(changement.error)}` });
      return setRetour({ ton: 'succes', texte: `Coordonnées enregistrées. Un e-mail de confirmation est parti à ${nouvelle} : votre adresse de connexion changera quand vous aurez cliqué sur son lien. D’ici là, l’ancienne reste valable.` });
    }
    setRetour({ ton: 'succes', texte: 'Profil enregistré.' });
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">Vos coordonnées</h2>
      <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Champ id="profil-prenom" libelle="Prénom" autoComplete="given-name" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          <Champ id="profil-nom" libelle="Nom" autoComplete="family-name" value={nom} onChange={(e) => setNom(e.target.value)} />
        </div>
        <Champ id="profil-email" libelle="Adresse e-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aide="C’est aussi votre identifiant de connexion." />
        <Champ id="profil-telephone" libelle="Téléphone" type="tel" autoComplete="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
        {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
        <Bouton type="submit" occupe={occupe}>
          Enregistrer mes coordonnées
        </Bouton>
      </form>
    </Carte>
  );
}

function FormulaireOrganisation({ lectureSeule, recharger }: { lectureSeule: boolean; recharger: () => Promise<void> }) {
  const { organisation } = useAuth();
  const o = organisation!;
  const [type, setType] = useState<TypeCompte>(o.type);
  const [nom, setNom] = useState(o.nom);
  const [siret, setSiret] = useState(o.siret ?? '');
  const [adresse, setAdresse] = useState(o.adresse ?? '');
  const [codePostal, setCodePostal] = useState(o.code_postal ?? '');
  const [ville, setVille] = useState(o.ville ?? '');
  const [carteNumero, setCarteNumero] = useState(o.carte_pro_numero ?? '');
  const [carteCci, setCarteCci] = useState(o.carte_pro_cci ?? '');
  const [retour, setRetour] = useState<Retour>(null);
  const [occupe, setOccupe] = useState(false);
  const societe = type !== 'particulier';

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const err = !nom.trim()
      ? 'Indiquez le nom qui figurera sur vos états des lieux.'
      : societe && siret.trim() && !siretValide(siret)
        ? 'Ce numéro SIRET n’est pas valide (14 chiffres).'
        : codePostal.trim() && !codePostalValide(codePostal)
          ? 'Le code postal doit compter 5 chiffres.'
          : '';
    if (err) return setRetour({ ton: 'erreur', texte: err });
    setOccupe(true);
    const { data, error } = await supabase
      .from('organisations')
      .update({
        type,
        nom: nom.trim(),
        siret: societe ? siret.replace(/\s/g, '') || null : null,
        adresse: adresse.trim() || null,
        code_postal: codePostal.trim() || null,
        ville: ville.trim() || null,
        carte_pro_numero: type === 'pro' ? carteNumero.trim() || null : null,
        carte_pro_cci: type === 'pro' ? carteCci.trim() || null : null,
      })
      .eq('id', o.id)
      .select('id');
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    // Les règles d'accès refusent sans erreur : aucune ligne modifiée = pas le droit.
    if (!data?.length) return setRetour({ ton: 'erreur', texte: 'Seul un administrateur du compte peut modifier ces informations.' });
    await recharger();
    setRetour({ ton: 'succes', texte: 'Informations enregistrées.' });
  }

  return (
    <Carte>
      <div>
        <h2 className="text-lg font-bold">Bailleur ou société</h2>
        <p className="text-sm text-discret">Ces informations sont reprises dans l’en-tête de vos états des lieux.</p>
      </div>
      <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
        <fieldset disabled={lectureSeule} className="flex flex-col gap-4">
          <Liste id="org-type" libelle="Type de compte" value={type} onChange={(e) => setType(e.target.value as TypeCompte)}>
            <option value="particulier">Particulier</option>
            <option value="sci">SCI</option>
            <option value="pro">Professionnel (agence, gestionnaire, conciergerie)</option>
          </Liste>
          <Champ id="org-nom" libelle={societe ? 'Dénomination sociale' : 'Nom du bailleur'} value={nom} onChange={(e) => setNom(e.target.value)} />
          {societe && <Champ id="org-siret" libelle="SIRET" inputMode="numeric" value={siret} onChange={(e) => setSiret(e.target.value)} aide="14 chiffres." />}
          <Champ id="org-adresse" libelle="Adresse" autoComplete="street-address" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <Champ id="org-cp" libelle="Code postal" inputMode="numeric" autoComplete="postal-code" value={codePostal} onChange={(e) => setCodePostal(e.target.value)} />
            <Champ id="org-ville" libelle="Ville" autoComplete="address-level2" value={ville} onChange={(e) => setVille(e.target.value)} />
          </div>
          {type === 'pro' && (
            <>
              <Champ id="org-carte" libelle="Numéro de carte professionnelle" value={carteNumero} onChange={(e) => setCarteNumero(e.target.value)} aide="Mention obligatoire quand vous intervenez comme mandataire." />
              <Champ id="org-cci" libelle="CCI de délivrance" value={carteCci} onChange={(e) => setCarteCci(e.target.value)} />
            </>
          )}
          {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
          {lectureSeule ? (
            <p className="text-sm text-discret">Seul un administrateur du compte peut modifier ces informations.</p>
          ) : (
            <Bouton type="submit" occupe={occupe}>
              Enregistrer ces informations
            </Bouton>
          )}
        </fieldset>
      </form>
    </Carte>
  );
}

function FormulaireMotDePasse() {
  const [motDePasse, setMotDePasse] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!motDePasseValide(motDePasse)) return setRetour({ ton: 'erreur', texte: `Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.` });
    setOccupe(true);
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    setMotDePasse('');
    setRetour({ ton: 'succes', texte: 'Mot de passe modifié.' });
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">Mot de passe</h2>
      <form onSubmit={envoyer} className="flex flex-col gap-4" noValidate>
        <Champ id="nouveau-mdp" libelle="Nouveau mot de passe" type="password" autoComplete="new-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} aide={`Au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`} />
        {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
        <Bouton type="submit" variante="contour" occupe={occupe}>
          Changer de mot de passe
        </Bouton>
      </form>
    </Carte>
  );
}

/** Réduit le logo à 600 pixels au plus et le rend en PNG : léger, et lisible par le moteur de documents. */
async function preparerLogo(fichier: File): Promise<Blob> {
  const image = await createImageBitmap(fichier);
  const r = Math.min(1, 600 / Math.max(image.width, image.height));
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(image.width * r));
  toile.height = Math.max(1, Math.round(image.height * r));
  toile.getContext('2d')!.drawImage(image, 0, 0, toile.width, toile.height);
  return new Promise((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error('conversion'))), 'image/png'));
}

/**
 * Prépare l'image de filigrane : PNG, 1 000 pixels au plus, transparence conservée.
 * Refuse une image sans fond transparent : posée sur chaque photo, elle la masquerait.
 */
async function preparerFiligrane(fichier: File): Promise<Blob> {
  const image = await createImageBitmap(fichier);
  if (Math.max(image.width, image.height) < 300) throw new Error('Image trop petite : prévoyez au moins 600 pixels de large pour un filigrane net.');
  const r = Math.min(1, 1000 / Math.max(image.width, image.height));
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(image.width * r));
  toile.height = Math.max(1, Math.round(image.height * r));
  const c = toile.getContext('2d')!;
  c.drawImage(image, 0, 0, toile.width, toile.height);
  const points = c.getImageData(0, 0, toile.width, toile.height).data;
  let transparents = 0;
  for (let i = 3; i < points.length; i += 4) if (points[i] < 40) transparents++;
  if (transparents / (points.length / 4) < 0.15) throw new Error('Cette image n’a pas de fond transparent : elle masquerait vos photos. Exportez-la en PNG avec un fond transparent.');
  return new Promise((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error('conversion'))), 'image/png'));
}

/** Présentation des documents : filigrane sur les photos (tous les comptes), logo en tête (comptes professionnels). */
function Presentation({ lectureSeule, recharger }: { lectureSeule: boolean; recharger: () => Promise<void> }) {
  const { organisation } = useAuth();
  const [filigrane, setFiligrane] = useState(organisation!.filigrane_photos);
  const [texte, setTexte] = useState(organisation!.filigrane_texte ?? '');
  const [logo, setLogo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [retour, setRetour] = useState<Retour>(null);
  const choix = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const choixImage = useRef<HTMLInputElement>(null);
  const org = organisation!;
  const pro = org.type === 'pro';

  useEffect(() => {
    if (!org.logo_path) return;
    let adresse: string | null = null;
    void supabase.storage.from('marque').download(org.logo_path).then(({ data }) => { if (data) { adresse = URL.createObjectURL(data); setLogo(adresse); } });
    return () => { if (adresse) URL.revokeObjectURL(adresse); };
  }, [org.logo_path]);

  useEffect(() => {
    if (!org.filigrane_image_path) return;
    let adresse: string | null = null;
    void supabase.storage.from('marque').download(org.filigrane_image_path).then(({ data }) => { if (data) { adresse = URL.createObjectURL(data); setImage(adresse); } });
    return () => { if (adresse) URL.revokeObjectURL(adresse); };
  }, [org.filigrane_image_path]);

  async function deposerFiligrane(fichier: File | undefined) {
    if (!fichier) return;
    setRetour(null);
    if (fichier.type !== 'image/png') return setRetour({ ton: 'erreur', texte: 'Choisissez une image PNG à fond transparent (un JPEG n’a pas de transparence).' });
    setOccupe(true);
    try {
      const prete = await preparerFiligrane(fichier);
      const chemin = `${org.id}/filigrane-${Date.now()}.png`;
      const depot = await supabase.storage.from('marque').upload(chemin, prete, { contentType: 'image/png' });
      if (depot.error) throw depot.error;
      const maj = await supabase.from('organisations').update({ filigrane_image_path: chemin, filigrane_photos: true }).eq('id', org.id);
      if (maj.error) throw maj.error;
      if (org.filigrane_image_path) await supabase.storage.from('marque').remove([org.filigrane_image_path]);
      setFiligrane(true);
      setImage(URL.createObjectURL(prete));
      await recharger();
      setRetour({ ton: 'succes', texte: 'Image de filigrane enregistrée. Ouvrez l’aperçu d’un état des lieux pour voir le rendu.' });
    } catch (err) {
      setRetour({ ton: 'erreur', texte: err instanceof Error && !('code' in err) && !('statusCode' in err) ? err.message : traduireErreur(err) });
    } finally {
      setOccupe(false);
      if (choixImage.current) choixImage.current.value = '';
    }
  }
  async function retirerFiligrane() {
    setOccupe(true); setRetour(null);
    const ancien = org.filigrane_image_path;
    const { error } = await supabase.from('organisations').update({ filigrane_image_path: null }).eq('id', org.id);
    if (!error && ancien) await supabase.storage.from('marque').remove([ancien]);
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    setImage(null);
    await recharger();
  }

  const [etatAuto, setEtatAuto] = useState<'repos' | 'envoi' | 'fait'>('repos');
  const [colonnes, setColonnes] = useState<2 | 3>(org.photos_colonnes === 3 ? 3 : 2);
  const [couleur, setCouleur] = useState(org.couleur_documents ?? '');
  async function regler(champs: Record<string, unknown>) {
    setEtatAuto('envoi'); setRetour(null);
    const { error } = await supabase.from('organisations').update(champs).eq('id', org.id);
    if (error) { setEtatAuto('repos'); return setRetour({ ton: 'erreur', texte: traduireErreur(error) }); }
    await recharger();
    setEtatAuto('fait');
  }
  // Enregistrement automatique : la case dès qu'on la touche, le texte une seconde après la dernière frappe.
  async function enregistrer(valeurs: { filigrane_photos: boolean; filigrane_texte: string | null }) {
    setEtatAuto('envoi'); setRetour(null);
    const { error } = await supabase.from('organisations').update(valeurs).eq('id', org.id);
    if (error) { setEtatAuto('repos'); return setRetour({ ton: 'erreur', texte: traduireErreur(error) }); }
    await recharger();
    setEtatAuto('fait');
  }
  useEffect(() => {
    const voulu = texte.trim() || null;
    if (lectureSeule || voulu === (org.filigrane_texte ?? null)) return;
    const attente = setTimeout(() => void enregistrer({ filigrane_photos: filigrane, filigrane_texte: voulu }), 1000);
    return () => clearTimeout(attente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texte]);
  async function deposer(fichier: File | undefined) {
    if (!fichier) return;
    setRetour(null);
    if (!['image/png', 'image/jpeg'].includes(fichier.type)) return setRetour({ ton: 'erreur', texte: 'Choisissez une image PNG ou JPEG.' });
    setOccupe(true);
    try {
      const image = await preparerLogo(fichier);
      // Nom nouveau à chaque dépôt : l'ancien logo ne reste pas en mémoire des navigateurs.
      const chemin = `${org.id}/logo-${Date.now()}.png`;
      const depot = await supabase.storage.from('marque').upload(chemin, image, { contentType: 'image/png' });
      if (depot.error) throw depot.error;
      const maj = await supabase.from('organisations').update({ logo_path: chemin }).eq('id', org.id);
      if (maj.error) throw maj.error;
      if (org.logo_path) await supabase.storage.from('marque').remove([org.logo_path]);
      setLogo(URL.createObjectURL(image));
      await recharger();
      setRetour({ ton: 'succes', texte: 'Logo enregistré. Il figurera en tête des prochains documents générés.' });
    } catch (err) {
      setRetour({ ton: 'erreur', texte: traduireErreur(err) });
    } finally {
      setOccupe(false);
      if (choix.current) choix.current.value = '';
    }
  }
  async function retirer() {
    setOccupe(true); setRetour(null);
    const ancien = org.logo_path;
    const { error } = await supabase.from('organisations').update({ logo_path: null }).eq('id', org.id);
    if (!error && ancien) await supabase.storage.from('marque').remove([ancien]);
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    setLogo(null);
    await recharger();
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">Présentation des documents</h2>
      {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={filigrane} disabled={lectureSeule}
            onChange={(e) => { setFiligrane(e.target.checked); void enregistrer({ filigrane_photos: e.target.checked, filigrane_texte: texte.trim() || null }); }} />
          <span><span className="font-semibold">Filigrane sur les photos</span><span className="block text-sm text-discret">Un bandeau au pied de chaque photo du document : votre nom, la date et l’heure de la prise de vue. Les photos d’origine restent intactes.</span></span>
        </label>
        {filigrane && <Champ id="filigrane-texte" libelle="Texte du filigrane" value={texte} maxLength={60} disabled={lectureSeule} onChange={(e) => { setTexte(e.target.value); setEtatAuto('repos'); }} placeholder={org.nom} aide="Laissez vide pour utiliser le nom du compte." />}
        <p className="text-sm text-discret" role="status" data-testid="etat-presentation">
          {etatAuto === 'envoi' ? 'Enregistrement…' : etatAuto === 'fait' ? '✓ Enregistré. S’applique aux prochains documents générés.' : 'Vos réglages s’enregistrent automatiquement.'}
        </p>
      </div>
      {filigrane && (
        <div className="flex flex-col gap-2 border-t border-trait pt-3">
          <p className="font-semibold">Image de filigrane (facultatif)</p>
          <p className="text-sm text-discret">Votre logo ou votre tampon, posé en bas à droite de chaque photo, en plus du bandeau.</p>
          {image ? (
            <div className="flex items-center gap-3 rounded-xl border-2 border-neuf bg-surface p-3" data-testid="filigrane-image-joint">
              <img src={image} alt="Image de filigrane" className="h-20 w-32 shrink-0 rounded-lg border border-trait object-contain p-1" style={{ background: 'repeating-conic-gradient(#d9dedd 0% 25%, #fff 0% 50%) 50% / 16px 16px' }} data-testid="filigrane-image" />
              <span className="min-w-0"><span className="block font-semibold text-neuf">✓ Image de filigrane jointe</span><span className="block text-sm text-discret">Elle sera posée sur chaque photo de vos prochains documents.</span></span>
            </div>
          ) : <p className="text-sm text-discret">Aucune image : seul le bandeau de texte est posé.</p>}
          {!lectureSeule && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border-2 border-marque px-4 text-center font-semibold text-marque">
                {image ? 'Changer d’image' : 'Choisir une image'}
                <input ref={choixImage} type="file" accept="image/png" className="sr-only" disabled={occupe} onChange={(e) => void deposerFiligrane(e.target.files?.[0])} data-testid="choisir-filigrane" />
              </label>
              {image && <Bouton variante="contour" disabled={occupe} onClick={retirerFiligrane}>Retirer l’image</Bouton>}
            </div>
          )}
          <ul className="list-disc pl-5 text-sm text-discret">
            <li><span className="font-semibold text-encre">Format</span> : PNG à fond transparent (pas de JPEG, qui n’a pas de transparence).</li>
            <li><span className="font-semibold text-encre">Taille</span> : 600 à 1 000 pixels de côté. Une image plus grande est réduite automatiquement.</li>
            <li><span className="font-semibold text-encre">Cadrage</span> : sans marge autour du logo ; rond, carré ou plus large que haut.</li>
            <li><span className="font-semibold text-encre">Couleur</span> : une seule teinte, foncée ou blanche, aux traits épais ; les dégradés et les détails fins disparaissent.</li>
            <li><span className="font-semibold text-encre">Rendu</span> : posée en bas à droite, comme un tampon, sur un quart de la largeur de la photo.</li>
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-trait pt-3">
        <p className="font-semibold">Photos du document</p>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Nombre de colonnes de photos">
          {([2, 3] as const).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={colonnes === n} disabled={lectureSeule} data-testid={`colonnes-${n}`}
              onClick={() => { setColonnes(n); void regler({ photos_colonnes: n }); }}
              className={`min-h-[48px] rounded-xl border-2 px-3 text-left ${colonnes === n ? 'border-marque bg-creux font-semibold' : 'border-trait'}`}>
              <span className="block">{n} colonnes</span><span className="block text-sm font-normal text-discret">{n === 2 ? 'Photos plus grandes' : 'Plus de photos par page'}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-discret">Les photos verticales et horizontales gardent leur format ; chaque rangée s’ajuste à leur hauteur.</p>
      </div>
      {pro && (
        <div className="flex flex-col gap-2 border-t border-trait pt-3">
          <p className="font-semibold">Couleur du document</p>
          <div className="flex flex-wrap items-center gap-2">
            {['', '#0f4c4a', '#1f3a5f', '#7a1f2b', '#b8966a', '#3b3b3b'].map((c) => (
              <button key={c || 'defaut'} type="button" disabled={lectureSeule} aria-label={c ? `Couleur ${c}` : 'Couleurs de Constatio'} aria-pressed={couleur === c} data-testid={`couleur-${c || 'defaut'}`}
                onClick={() => { setCouleur(c); void regler({ couleur_documents: c || null }); }}
                className={`h-10 w-10 rounded-full border-2 ${couleur === c ? 'border-encre ring-2 ring-repere' : 'border-trait'}`}
                style={{ background: c || 'linear-gradient(135deg, #0f4c4a 50%, #f4b61a 50%)' }} />
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="color" value={couleur || '#0f4c4a'} disabled={lectureSeule} onChange={(e) => setCouleur(e.target.value.toLowerCase())} onBlur={(e) => void regler({ couleur_documents: e.target.value.toLowerCase() })} className="h-10 w-12 rounded border border-trait" aria-label="Autre couleur" />
              Autre couleur
            </label>
          </div>
          <p className="text-sm text-discret">Bandeaux, titres et repères du document prennent cette couleur. Une teinte trop claire est foncée automatiquement pour rester lisible.</p>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-trait pt-3">
        <p className="font-semibold">Logo en page de garde</p>
        {pro ? (
          <>
            {logo ? (
            <div className="flex items-center gap-3 rounded-xl border-2 border-neuf bg-surface p-3" data-testid="logo-joint">
              <img src={logo} alt="Logo" className="h-20 w-32 shrink-0 rounded-lg border border-trait object-contain p-1" style={{ background: '#fff' }} data-testid="logo" />
              <span className="min-w-0"><span className="block font-semibold text-neuf">✓ Logo joint</span><span className="block text-sm text-discret">Il figurera sur la page de garde de vos prochains documents.</span></span>
            </div>
            ) : <p className="text-sm text-discret">Aucun logo. Les documents portent le nom du compte.</p>}
            {!lectureSeule && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border-2 border-marque px-4 text-center font-semibold text-marque">
                  {logo ? 'Changer de logo' : 'Choisir un logo'}
                  <input ref={choix} type="file" accept="image/png,image/jpeg" className="sr-only" disabled={occupe} onChange={(e) => void deposer(e.target.files?.[0])} data-testid="choisir-logo" />
                </label>
                {logo && <Bouton variante="contour" disabled={occupe} onClick={retirer}>Retirer le logo</Bouton>}
              </div>
            )}
            <p className="text-sm text-discret">PNG ou JPEG, de préférence sur fond blanc ou transparent.</p>
          </>
        ) : <p className="text-sm text-discret">Réservé aux comptes professionnels. Choisissez « Professionnel » dans « Bailleur ou société » ci-dessus pour l’activer.</p>}
      </div>
    </Carte>
  );
}
