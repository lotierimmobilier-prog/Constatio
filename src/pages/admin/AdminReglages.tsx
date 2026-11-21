import { useState, type FormEvent } from 'react';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { appel, jour } from '../../lib/admin';
import { supabase } from '../../lib/supabase';
import { emailValide } from '../../lib/validation';
import { useDonnee, useRoleAdmin } from './CoquilleAdmin';

const MOT = 'PRODUCTION';

/** Réservé au super administrateur : le coupe-circuit « mode test » et les administrateurs. */
export function AdminReglages() {
  const role = useRoleAdmin();
  const test = useDonnee(async () => (await supabase.from('parametres').select('valeur').eq('cle', 'mode_test').single()).data?.valeur === true);
  const admins = useDonnee(() => appel<{ email: string; role: string; depuis: string }[]>('admin_administrateurs'));
  const [saisie, setSaisie] = useState('');
  const [email, setEmail] = useState('');
  const [nouveauRole, setNouveauRole] = useState('admin');
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  if (role !== 'superadmin') return <Alerte>Cette page est réservée au super administrateur.</Alerte>;

  const agir = async (action: () => Promise<unknown>, succes: string) => {
    try { await action(); setRetour({ ton: 'succes', texte: succes }); }
    catch (e) { setRetour({ ton: 'erreur', texte: (e as Error).message }); }
    await Promise.all([test.recharger(), admins.recharger()]);
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
