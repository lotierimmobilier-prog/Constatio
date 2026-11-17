import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type TypeCompte } from '../../auth/AuthProvider';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { traduireErreur } from '../../lib/erreurs';
import { useSync } from '../../lib/local';
import { supabase } from '../../lib/supabase';
import { LONGUEUR_MOT_DE_PASSE, codePostalValide, motDePasseValide, siretValide } from '../../lib/validation';

type Retour = { ton: 'succes' | 'erreur'; texte: string } | null;
const ROLES = { proprietaire: 'Propriétaire du compte', admin: 'Administrateur', agent: 'Agent' } as const;

export function Compte() {
  const { session, profil, organisation, role, recharger, deconnecter } = useAuth();
  const aller = useNavigate();
  const { enAttente, enLigne } = useSync();
  const [confirmer, setConfirmer] = useState(false);
  if (!profil || !organisation) return null;
  const peutGerer = role === 'proprietaire' || role === 'admin';

  return (
    <>
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <p className="text-sm text-discret">
        {session?.user.email} · {role ? ROLES[role] : ''}
      </p>
      <FormulaireProfil key={profil.id} recharger={recharger} />
      <FormulaireOrganisation key={organisation.id} lectureSeule={!peutGerer} recharger={recharger} />
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
  const { profil } = useAuth();
  const [prenom, setPrenom] = useState(profil!.prenom);
  const [nom, setNom] = useState(profil!.nom);
  const [telephone, setTelephone] = useState(profil!.telephone ?? '');
  const [retour, setRetour] = useState<Retour>(null);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return setRetour({ ton: 'erreur', texte: 'Indiquez votre nom.' });
    setOccupe(true);
    const { error } = await supabase
      .from('profils')
      .update({ prenom: prenom.trim(), nom: nom.trim(), telephone: telephone.trim() || null })
      .eq('id', profil!.id);
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: traduireErreur(error) });
    await recharger();
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
