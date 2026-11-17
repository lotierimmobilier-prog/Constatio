import { local, useSync } from '../lib/local';

/** Dit en permanence où en sont les saisies : gardées sur l'appareil, en cours d'envoi, ou refusées. */
export function BandeauSync() {
  const { enLigne, enAttente, rejets } = useSync();
  const n = `${enAttente} modification${enAttente > 1 ? 's' : ''}`;
  // Collé en haut de l'écran : l'état des saisies reste visible pendant toute la visite.
  return (
    <div className="sticky top-0 z-10">
      {!enLigne && (
        <div role="status" className="bg-encre px-4 py-2 text-center text-sm font-semibold text-fond" data-testid="hors-ligne">
          Hors connexion. {enAttente ? `${n} gardée${enAttente > 1 ? 's' : ''} sur cet appareil, envoyée${enAttente > 1 ? 's' : ''} au retour du réseau.` : 'Vous pouvez continuer : vos saisies seront gardées sur cet appareil.'}
        </div>
      )}
      {enLigne && enAttente > 0 && (
        <div role="status" className="bg-creux px-4 py-1 text-center text-sm text-discret" data-testid="envoi">Envoi de {n}…</div>
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
