import { useState, type FormEvent } from 'react';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { appel, jour } from '../../lib/admin';
import { supabase } from '../../lib/supabase';
import { emailValide } from '../../lib/validation';
import { useDonnee, useRoleAdmin } from './CoquilleAdmin';

const MOT = 'PRODUCTION';
const ADRESSE_WEBHOOK = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-stripe`;
const EVENEMENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded'];
const CLES = [
  { nom: 'stripe_cle_test', libelle: 'Clé secrète de test', exemple: 'sk_test_…' },
  { nom: 'stripe_webhook_test', libelle: 'Secret du webhook de test', exemple: 'whsec_…' },
  { nom: 'stripe_cle_reelle', libelle: 'Clé secrète réelle', exemple: 'sk_live_…' },
  { nom: 'stripe_webhook_reel', libelle: 'Secret du webhook réel', exemple: 'whsec_…' },
];

const CLES_DOCUSEAL = [
  { nom: 'docuseal_cle', libelle: 'Clé API DocuSeal', exemple: 'Clé de l’API' },
  { nom: 'docuseal_url', libelle: 'Adresse de l’API (facultatif)', exemple: 'https://api.docuseal.eu' },
];

const CLES_COURRIEL = [
  { nom: 'smtp_utilisateur', libelle: 'Adresse de la boîte d’envoi', exemple: 'bonjour@constatio.fr', lisible: true },
  { nom: 'smtp_mot_de_passe', libelle: 'Mot de passe de cette boîte', exemple: 'Mot de passe' },
  { nom: 'smtp_hote', libelle: 'Serveur d’envoi (facultatif)', exemple: 'smtp.hostinger.com:465', lisible: true },
];

/** Une clé en écriture seule : on la colle, on l'enregistre, on n'en revoit que la fin. */
function ChampCle({ cle, connue, enregistrer }: { cle: (typeof CLES)[number] & { lisible?: boolean }; connue?: { fin: string; updated_at: string }; enregistrer: (valeur: string) => Promise<void> }) {
  const [valeur, setValeur] = useState('');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void enregistrer(valeur.trim()).then(() => setValeur('')); }} data-testid={`cle-${cle.nom}`}>
      <Champ id={cle.nom} libelle={cle.libelle} type={cle.lisible ? 'text' : 'password'} autoComplete="off" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={cle.exemple}
        aide={connue ? `Enregistrée le ${jour(connue.updated_at)} · ${cle.lisible ? connue.fin : `se termine par ${connue.fin}`}` : 'Non renseignée'} />
      <div className="flex gap-3">
        <Bouton type="submit" className="!w-auto px-5" disabled={!valeur.trim()}>Enregistrer</Bouton>
        {connue && <button type="button" className="font-semibold text-hs underline underline-offset-4" onClick={() => void enregistrer('')}>Effacer</button>}
      </div>
    </form>
  );
}

/** Réservé au super administrateur : le coupe-circuit « mode test » et les administrateurs. */
export function AdminReglages() {
  const role = useRoleAdmin();
  const test = useDonnee(async () => (await supabase.from('parametres').select('valeur').eq('cle', 'mode_test').single()).data?.valeur === true);
  const cles = useDonnee(() => appel<{ nom: string; fin: string; updated_at: string }[]>('admin_cles'));
  const admins = useDonnee(() => appel<{ email: string; role: string; depuis: string }[]>('admin_administrateurs'));
  const [saisie, setSaisie] = useState('');
  const [email, setEmail] = useState('');
  const [nouveauRole, setNouveauRole] = useState('admin');
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  if (role !== 'superadmin') return <Alerte>Cette page est réservée au super administrateur.</Alerte>;

  const agir = async (action: () => Promise<unknown>, succes: string) => {
    try { await action(); setRetour({ ton: 'succes', texte: succes }); }
    catch (e) { setRetour({ ton: 'erreur', texte: (e as Error).message }); }
    await Promise.all([test.recharger(), admins.recharger(), cles.recharger()]);
  };
  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    if (!emailValide(email)) return setRetour({ ton: 'erreur', texte: 'Cette adresse e-mail n’est pas valide.' });
    void agir(() => appel('admin_definir_role', { p_email: email, p_role: nouveauRole }), `${email.trim()} est maintenant ${nouveauRole === 'superadmin' ? 'super administrateur' : 'administrateur'}.`).then(() => setEmail(''));
  };

  return (
    <>
      <h1 className="text-2xl font-bold">Réglages</h1>
      {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}

      <Carte>
        <h2 className="text-lg font-bold">Mode test</h2>
        {test.donnee === null ? <p className="text-discret">Chargement…</p> : test.donnee ? (
          <>
            <p className="max-w-[65ch] text-sm">Le mode test est <span className="font-semibold">actif</span> : aucun e-mail, aucune signature ni aucun paiement réels. Le couper met le service en production pour tous les clients.</p>
            <Champ id="confirmation" libelle={`Pour passer en production, tapez ${MOT}`} value={saisie} onChange={(e) => setSaisie(e.target.value)} autoComplete="off" />
            <Bouton className="sm:!w-auto sm:self-start sm:px-6 !bg-hs !text-surface" disabled={saisie !== MOT}
              onClick={() => { setSaisie(''); void agir(() => appel('admin_mode_test', { p_actif: false }), 'Le service est en production.'); }}>
              Couper le mode test
            </Bouton>
          </>
        ) : (
          <>
            <p className="max-w-[65ch] text-sm">Le service est <span className="font-semibold">en production</span> : e-mails, signatures et paiements sont réels.</p>
            <Bouton variante="contour" className="sm:!w-auto sm:self-start sm:px-6" onClick={() => void agir(() => appel('admin_mode_test', { p_actif: true }), 'Mode test réactivé : plus aucun envoi réel.')}>Réactiver le mode test</Bouton>
          </>
        )}
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Paiement Stripe</h2>
        <p className="max-w-[65ch] text-sm">Collez ici les clés de votre compte Stripe (Développeurs → Clés API). Une clé enregistrée ne peut plus être relue : seuls ses quatre derniers caractères restent affichés. En mode test, seules les clés de test servent.</p>
        {cles.erreur && <Alerte>{cles.erreur}</Alerte>}
        <div className="grid gap-4 sm:grid-cols-2">
          {CLES.map((c) => <ChampCle key={c.nom} cle={c} connue={cles.donnee?.find((x) => x.nom === c.nom)} enregistrer={(valeur) => agir(() => appel('admin_definir_cle', { p_nom: c.nom, p_valeur: valeur }), valeur ? `${c.libelle} : enregistrée.` : `${c.libelle} : effacée.`)} />)}
        </div>
        <div className="flex flex-col gap-1 border-t border-trait pt-3 text-sm">
          <p className="font-semibold">Adresse à déclarer chez Stripe (Développeurs → Webhooks → Ajouter un point de terminaison)</p>
          <p className="break-all rounded-lg bg-creux px-2 py-1 font-mono text-xs" data-testid="adresse-webhook">{ADRESSE_WEBHOOK}</p>
          <p className="text-discret">Événements à cocher : {EVENEMENTS.join(', ')}. Stripe affiche ensuite le « secret de signature » (whsec_…) à coller ci-dessus. À faire une fois en mode test, une fois en mode réel.</p>
        </div>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Signature électronique DocuSeal</h2>
        <p className="max-w-[65ch] text-sm">La même clé que Signabail (DocuSeal → Paramètres → API). Laissez l’adresse vide pour le nuage européen de DocuSeal. En mode test, aucune demande ne part.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {CLES_DOCUSEAL.map((c) => <ChampCle key={c.nom} cle={c} connue={cles.donnee?.find((x) => x.nom === c.nom)} enregistrer={(valeur) => agir(() => appel('admin_definir_cle', { p_nom: c.nom, p_valeur: valeur }), valeur ? `${c.libelle} : enregistrée.` : `${c.libelle} : effacée.`)} />)}
        </div>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Envoi des e-mails</h2>
        <p className="max-w-[65ch] text-sm">La boîte du domaine (Hostinger → E-mails). Elle envoie l’exemplaire signé à chaque partie, prévient d’une réserve à valider et de sa réponse, et porte les e-mails de compte (confirmation d’adresse, mot de passe oublié). C’est le seul endroit où elle se règle. Le mot de passe n’est jamais réaffiché. En mode test, aucun message ne part. Tant que la boîte n’est pas réglée, les messages attendent (sept jours au plus).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {CLES_COURRIEL.map((c) => <ChampCle key={c.nom} cle={c} connue={cles.donnee?.find((x) => x.nom === c.nom)} enregistrer={(valeur) => agir(() => appel('admin_definir_cle', { p_nom: c.nom, p_valeur: valeur }), valeur ? `${c.libelle} : enregistré.` : `${c.libelle} : effacé.`)} />)}
        </div>
      </Carte>

      <Carte>
        <h2 className="text-lg font-bold">Administrateurs</h2>
        {admins.erreur && <Alerte>{admins.erreur}</Alerte>}
        <ul className="flex flex-col divide-y divide-trait text-sm">
          {admins.donnee?.map((a) => (
            <li key={a.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-semibold">{a.email}</span> · {a.role === 'superadmin' ? 'super administrateur' : 'administrateur'} · depuis le {jour(a.depuis)}</span>
              <button className="font-semibold text-hs underline underline-offset-4" onClick={() => void agir(() => appel('admin_definir_role', { p_email: a.email, p_role: null }), `${a.email} n’est plus administrateur.`)}>Retirer</button>
            </li>
          ))}
        </ul>
        <form onSubmit={ajouter} className="grid items-end gap-3 border-t border-trait pt-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" noValidate>
          <Champ id="admin-email" libelle="Adresse du compte à nommer" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aide="La personne doit déjà avoir un compte Constatio." />
          <Liste id="admin-role" libelle="Rôle" value={nouveauRole} onChange={(e) => setNouveauRole(e.target.value)}>
            <option value="admin">Administrateur</option><option value="superadmin">Super administrateur</option>
          </Liste>
          <Bouton type="submit" className="!w-auto px-5">Nommer</Bouton>
        </form>
      </Carte>
    </>
  );
}
