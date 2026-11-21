import { useRef } from 'react';
import { local, useSync } from '../lib/local';

/** Dit en permanence où en sont les saisies : gardées sur l'appareil, en cours d'envoi, ou refusées. */
export function BandeauSync() {
  const { enLigne, enAttente, rejets } = useSync();
  const n = `${enAttente} modification${enAttente > 1 ? 's' : ''}`;
  // Avancement de l'envoi : le plus grand nombre vu en attente sert de total, jusqu'à ce que la file soit vide.
  const total = useRef(0);
  total.current = enAttente === 0 ? 0 : Math.max(total.current, enAttente);
  const pourcent = total.current ? Math.round((100 * (total.current - enAttente)) / total.current) : 0;
  // Collé en haut de l'écran : l'état des saisies reste visible pendant toute la visite.
  return (
    <div className="sticky top-0 z-10">
      {!enLigne && (
        <div role="status" className="bg-encre px-4 py-2 text-center text-sm font-semibold text-fond" data-testid="hors-ligne">
          Hors connexion. {enAttente ? `${n} gardée${enAttente > 1 ? 's' : ''} sur cet appareil, envoyée${enAttente > 1 ? 's' : ''} au retour du réseau.` : 'Vous pouvez continuer : vos saisies seront gardées sur cet appareil.'}
        </div>
      )}
      {enLigne && enAttente > 0 && (
        <div role="status" className="bg-creux text-sm text-discret" data-testid="envoi">
          <div className="flex items-center justify-center gap-2 px-4 py-1">
            <span>Envoi de {n}…</span>
            <span className="font-semibold tabular-nums text-marque" data-testid="envoi-pourcent">{pourcent} %</span>
          </div>
          <div className="h-1 bg-trait" role="progressbar" aria-label="Envoi des modifications" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pourcent}>
            <div className="h-full bg-repere transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(pourcent, 4)}%` }} />
          </div>
        </div>
      )}
      {rejets.length > 0 && (
        <div role="alert" className="border-b-4 border-hs bg-surface px-4 py-3 text-sm" data-testid="rejets">
          <p className="font-semibold">Le serveur a refusé {rejets.length > 1 ? `${rejets.length} modifications` : 'une modification'} faite{rejets.length > 1 ? 's' : ''} hors connexion :</p>
          <ul className="list-disc pl-5">{rejets.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="mt-1 text-discret">L’affichage a été remis à jour avec ce qui est réellement enregistré.</p>
          <button type="button" className="mt-2 font-semibold text-marque underline underline-offset-4" onClick={() => void local.acquitterRejets()}>J’ai compris</button>
        </div>
      )}
    </div>
  );
}
