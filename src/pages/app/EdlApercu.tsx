import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnteteEdl, useVerrou } from '../../components/EnteteEdl';
import { Signatures } from '../../components/Signatures';
import { Alerte, Bouton, Carte, classesBouton } from '../../components/ui';
import { adresseDocument, construireApercu, genererDocument, rouvrir, type Apercu } from '../../lib/document';
import { chargerEdl, controlerEdl, type EdlLigne } from '../../lib/edl';

const poids = (octets: number) => (octets > 900_000 ? `${(octets / 1_000_000).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(octets / 1000))} ko`);

/** Aperçu gratuit du document, puis génération du document définitif. */
export function EdlApercu() {
  const { id } = useVerrou();
  const [edl, setEdl] = useState<EdlLigne | null>(null);
  const [bloquants, setBloquants] = useState(0);
  const [apercu, setApercu] = useState<(Apercu & { adresse: string }) | null>(null);
  const [definitif, setDefinitif] = useState<string | null>(null);
  const [exemplaireSigne, setExemplaireSigne] = useState<string | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'generation' | 'introuvable'>('chargement');
  const [message, setMessage] = useState<{ ton: 'erreur' | 'succes' | 'info'; texte: string; versCompte?: boolean } | null>(null);
  const [confirmer, setConfirmer] = useState(false);

  const charger = useCallback(async () => {
    const fiche = await chargerEdl(id);
    if (!fiche) return setEtat('introuvable');
    setEdl(fiche.edl);
    setBloquants((await controlerEdl(id))?.alertes.filter((a) => a.niveau === 'bloquant').length ?? 0);
    setDefinitif(fiche.edl.pdf_path ? await adresseDocument(fiche.edl.pdf_path) : null);
    setExemplaireSigne(fiche.edl.pdf_signe_path ? await adresseDocument(fiche.edl.pdf_signe_path) : null);
    if (fiche.edl.statut === 'brouillon') {
      const a = await construireApercu(id);
      if (a) setApercu((ancien) => { if (ancien) URL.revokeObjectURL(ancien.adresse); return { ...a, adresse: URL.createObjectURL(new Blob([a.pdf as BlobPart], { type: 'application/pdf' })) }; });
    }
    setEtat('pret');
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  async function generer() {
    setConfirmer(false);
    setEtat('generation');
    setMessage(null);
    const r = await genererDocument(id);
    if (r.statut === 'genere' || r.statut === 'deja') {
      setMessage({ ton: 'succes', texte: `Document généré.${'photos_manquantes' in r && r.photos_manquantes ? ` ${r.photos_manquantes} photo(s) n’ont pas pu être jointes : rouvrez l’état des lieux pour les reprendre.` : ''}` });
    } else if (r.statut === 'reseau') {
      setMessage({ ton: 'info', texte: 'Pas de réseau, ou des saisies attendent encore d’être envoyées. Le document définitif se génère une fois la connexion revenue ; l’aperçu reste disponible.' });
    } else if (r.statut === 'refuse') {
      const textes: Record<string, string> = {
        credit: 'Aucun crédit disponible pour ce document. Rien n’a été débité.',
        incomplet: 'Des mentions obligatoires manquent : corrigez-les dans les contrôles.',
        signe: 'Cet état des lieux est déjà signé.',
        session: 'Votre session a expiré : reconnectez-vous.',
      };
      setMessage({ ton: 'erreur', texte: textes[r.motif] ?? 'La génération a échoué. Rien n’est perdu : réessayez dans un instant.', versCompte: r.motif === 'credit' });
    }
    await charger();
  }

  async function corriger() {
    setMessage(null);
    const erreur = await rouvrir(id);
    if (erreur) setMessage({ ton: 'erreur', texte: erreur });
    await charger();
  }

  if (etat === 'introuvable') return <Alerte>Cet état des lieux n’existe pas ou ne vous est pas accessible. <Link to="/app" className="font-semibold underline">Revenir à la liste</Link></Alerte>;
  if (!edl || etat === 'chargement') return <p className="text-center text-discret">Préparation du document…</p>;

  const nom = `etat-des-lieux-${edl.type === 'sortant' ? 'sortie' : edl.type === 'entrant' ? 'entree' : 'releve'}-${edl.date_edl.slice(0, 10)}`;
  return (
    <>
      <EnteteEdl id={id} titre={edl.statut === 'brouillon' ? 'Aperçu et document' : 'Document'} verrouille={false}
        intro={edl.statut === 'brouillon' ? 'Relisez le document tel qu’il sera remis aux parties, puis générez la version définitive.' : undefined} />
      {message && <Alerte ton={message.ton}>{message.texte}{message.versCompte && <> <Link to="/app/compte" className="font-semibold underline">Voir mon compte</Link></>}</Alerte>}

      {edl.statut === 'brouillon' && (
        <>
          <Carte>
            <h2 className="text-lg font-bold">Aperçu</h2>
            <p className="text-sm text-discret">Gratuit, sans valeur de preuve : chaque page porte la mention « Aperçu ». Il se construit sur votre appareil, même sans réseau.</p>
            {apercu ? (
              <>
                <a href={apercu.adresse} target="_blank" rel="noreferrer" className={classesBouton('repere')} data-testid="ouvrir-apercu">Ouvrir l’aperçu ({poids(apercu.pdf.length)})</a>
                <a href={apercu.adresse} download={`apercu-${nom}.pdf`} className="text-center text-sm font-semibold text-marque underline underline-offset-4" data-testid="telecharger-apercu">Télécharger l’aperçu</a>
                {apercu.photosAbsentes > 0 && <p className="text-sm text-discret">{apercu.photosAbsentes} photo(s) prises sur un autre appareil ne sont pas disponibles sans réseau : elles figureront dans le document définitif.</p>}
              </>
            ) : <p className="text-sm">L’aperçu n’a pas pu être construit.</p>}
          </Carte>
          <Carte>
            <h2 className="text-lg font-bold">Document définitif</h2>
            {bloquants > 0 ? (
              <>
                <p className="text-sm">{bloquants} mention{bloquants > 1 ? 's' : ''} obligatoire{bloquants > 1 ? 's' : ''} manque{bloquants > 1 ? 'nt' : ''} encore.</p>
                <Link to={`/app/edl/${id}/controles`} className={classesBouton('contour')}>Voir les contrôles</Link>
              </>
            ) : confirmer ? (
              <>
                <p className="text-sm">{edl.credit_consomme ? 'Ce document a déjà été réglé : le régénérer ne coûte rien.' : 'La génération utilise 1 crédit.'} Une fois généré, l’état des lieux est figé ; vous pourrez le rouvrir pour le corriger, sans nouveau crédit, tant que personne n’a signé.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Bouton variante="contour" onClick={() => setConfirmer(false)}>Annuler</Bouton>
                  <Bouton onClick={generer} data-testid="confirmer-generation">Générer</Bouton>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-discret">Sans filigrane, avec son empreinte numérique : c’est lui que les parties signeront.</p>
                <Bouton disabled={etat === 'generation'} onClick={() => setConfirmer(true)} data-testid="generer">{etat === 'generation' ? 'Génération en cours…' : 'Générer le document définitif'}</Bouton>
              </>
            )}
          </Carte>
        </>
      )}

      {edl.statut === 'signe' && (
        <Carte>
          <h2 className="text-lg font-bold">Document signé</h2>
          <p className="text-sm">Toutes les parties ont signé. L’état des lieux est définitivement figé.</p>
          {exemplaireSigne ? (
            <>
              <a href={exemplaireSigne} target="_blank" rel="noreferrer" className={classesBouton('repere')} data-testid="ouvrir-signe">Ouvrir l’exemplaire signé</a>
              <p className="text-sm text-discret">Il contient les signatures et le dossier de preuve. Remettez-en un exemplaire à chaque partie.</p>
              <p className="break-all text-xs text-discret" data-testid="empreinte-signe">Empreinte SHA-256 : {edl.pdf_signe_sha256}</p>
            </>
          ) : <p className="text-sm">Le document est conservé sur le serveur : il s’ouvre dès que le réseau revient.</p>}
        </Carte>
      )}

      {edl.statut === 'termine' && (
        <>
          <Carte>
            <h2 className="text-lg font-bold">Document définitif</h2>
            {edl.pdf_path ? (
              definitif ? (
                <>
                  <a href={definitif} target="_blank" rel="noreferrer" className={classesBouton('repere')} data-testid="ouvrir-document">Ouvrir le document</a>
                  <p className="break-all text-xs text-discret" data-testid="empreinte">Empreinte SHA-256 : {edl.pdf_sha256}</p>
                </>
              ) : <p className="text-sm">Le document est conservé sur le serveur : il s’ouvre dès que le réseau revient.</p>
            ) : (
              <>
                <p className="text-sm">L’état des lieux est terminé, mais son document n’a pas pu être déposé. Relancez la génération : elle ne coûte rien.</p>
                <Bouton disabled={etat === 'generation'} onClick={generer} data-testid="generer">{etat === 'generation' ? 'Génération en cours…' : 'Relancer la génération'}</Bouton>
              </>
            )}
            <p className="text-sm text-discret">Une erreur ? Tant que personne n’a signé, rouvrez l’état des lieux : le document actuel est retiré, et le nouveau ne coûte rien.</p>
            <Bouton variante="contour" onClick={corriger} data-testid="rouvrir">Rouvrir pour corriger</Bouton>
          </Carte>
          {edl.pdf_path && <Signatures edlId={id} documentAdresse={definitif} onSigne={() => { setMessage({ ton: 'succes', texte: 'Toutes les parties ont signé : l’exemplaire signé est prêt.' }); void charger(); }} />}
        </>
      )}
    </>
  );
}
