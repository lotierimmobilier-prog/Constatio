import { Alerte } from '../../components/ui';
import { ACTIONS, appel, euros, instant } from '../../lib/admin';
import { useDonnee } from './CoquilleAdmin';

interface Ligne { id: number; admin_email: string | null; action: string; cible: string | null; details: Record<string, unknown>; created_at: string }

/** Une phrase lisible pour chaque action, plutôt que du JSON. */
function resume(l: Ligne): string {
  const d = l.details as Record<string, any>;
  switch (l.action) {
    case 'credits.offerts': return `${d.quantite} crédit${d.quantite > 1 ? 's' : ''} · motif : ${d.motif}`;
    case 'credits.retires': return `${d.retires} crédit${d.retires > 1 ? 's' : ''} retiré${d.retires > 1 ? 's' : ''} · motif : ${d.motif}`;
    case 'tarif.modifie': return `${l.cible} : ${euros(d.avant.montant_cents)} → ${euros(d.apres.montant_cents)}, ${d.avant.credits} → ${d.apres.credits} crédit(s), ${d.apres.actif ? 'en vente' : 'retiré de la vente'}`;
    case 'mode_test': return d.actif ? 'Mode test activé' : 'Mode test coupé : le service est en production';
    case 'compte.test': return d.est_test ? 'Marqué compte de test' : 'N’est plus un compte de test';
    case 'admin.role': return `${l.cible} : ${d.role ?? 'rôle retiré'}`;
    case 'admin.designe_par_le_serveur': return `${l.cible} : ${d.role}`;
    case 'signabail.rejoue': return `Issue : ${d.issue}`;
    default: return '';
  }
}

export function AdminJournal() {
  const { donnee: lignes, erreur } = useDonnee(() => appel<Ligne[]>('admin_journal_lire', { p_limite: 200 }));
  return (
    <>
      <h1 className="text-2xl font-bold">Journal d’administration</h1>
      <p className="max-w-[65ch] text-sm text-discret">Toute action d’un administrateur est inscrite ici, avec son auteur et sa date. Le journal ne se modifie pas et ne s’efface pas.</p>
      {erreur && <Alerte>{erreur}</Alerte>}
      {lignes && lignes.length === 0 && <p className="text-discret">Aucune action pour l’instant.</p>}
      <ol className="flex flex-col divide-y divide-trait rounded-2xl border border-trait bg-surface text-sm">
        {lignes?.map((l) => (
          <li key={l.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <span className="tabular-nums text-discret">{instant(l.created_at)}</span>
            <span><span className="font-semibold">{ACTIONS[l.action] ?? l.action}</span>{resume(l) && <span> · {resume(l)}</span>}<span className="block text-discret">{l.admin_email ?? 'serveur'}</span></span>
          </li>
        ))}
      </ol>
    </>
  );
}
