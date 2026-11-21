import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Champ, Liste } from '../../components/ui';
import { chargerEdl, type Partie, type RolePartie, type TypeEdl } from '../../lib/edl';
import { local } from '../../lib/local';
import { emailValide } from '../../lib/validation';

const ROLES: Record<RolePartie, string> = {
  bailleur: 'Bailleur',
  locataire: 'Locataire',
  mandataire_bailleur: 'Mandataire du bailleur',
  mandataire_locataire: 'Mandataire du locataire',
};
const nomComplet = (p: Pick<Partie, 'prenom' | 'nom'>) => [p.prenom, p.nom].filter(Boolean).join(' ');

/** Identité des parties et de leurs mandataires : mention obligatoire de l'état des lieux. */
export function EdlParties() {
  const { id } = useParams();
  const [parties, setParties] = useState<Partie[]>([]);
  const [type, setType] = useState<TypeEdl>('entrant');
  const [verrouille, setVerrouille] = useState(false);
  const [charge, setCharge] = useState(false);

  const charger = useCallback(async () => {
    const fiche = await chargerEdl(id!);
    setParties(await local.lister<Partie>('edl_parties', 'edl_id', id!));
    if (fiche) {
      setType(fiche.edl.type);
      setVerrouille(fiche.edl.statut !== 'brouillon');
    }
    setCharge(true);
  }, [id]);
  useEffect(() => { void charger(); }, [charger]);

  async function ajouter(role: RolePartie) {
    const represente = role === 'mandataire_bailleur' ? parties.find((p) => p.role === 'bailleur') : role === 'mandataire_locataire' ? parties.find((p) => p.role === 'locataire') : undefined;
    await local.inserer('edl_parties', {
      id: crypto.randomUUID(), edl_id: id!, role, prenom: '', nom: '', represente_id: represente?.id ?? null, doit_signer: true,
      ordre: parties.length ? Math.max(...parties.map((p) => p.ordre)) + 1 : 0,
    }, ROLES[role]);
    await charger();
  }

  if (!charge) return <p className="text-center text-discret">Chargement…</p>;
  const aBailleur = parties.some((p) => p.role === 'bailleur');
  const aLocataire = parties.some((p) => p.role === 'locataire');

  return (
    <>
      <Link to={`/app/edl/${id}`} className="text-sm font-semibold text-marque">← Retour à l’état des lieux</Link>
      <h1 className="text-2xl font-bold">Parties</h1>
      <p className="text-sm text-discret">L’état des lieux est contradictoire : il est établi en présence du bailleur et du locataire, ou de leurs mandataires.</p>
      {verrouille && <Alerte ton="info">Document généré : cet état des lieux ne se modifie plus. Tant que personne n’a signé, vous pouvez le rouvrir depuis « Aperçu et document ».</Alerte>}

      {parties.map((p) => (
        <FichePartie key={p.id} partie={p} parties={parties} sortie={type === 'sortant'} verrouille={verrouille} recharger={charger} />
      ))}

      {!verrouille && (
        <div className="flex flex-col gap-2">
          <Bouton variante="contour" onClick={() => ajouter('locataire')}>Ajouter un locataire</Bouton>
          {!aBailleur && <Bouton variante="contour" onClick={() => ajouter('bailleur')}>Ajouter le bailleur</Bouton>}
          {aBailleur && <Bouton variante="contour" onClick={() => ajouter('mandataire_bailleur')}>Ajouter un mandataire du bailleur</Bouton>}
          {aLocataire && <Bouton variante="contour" onClick={() => ajouter('mandataire_locataire')}>Ajouter un mandataire du locataire</Bouton>}
        </div>
      )}
    </>
  );
}

function FichePartie({ partie: p, parties, sortie, verrouille, recharger }: { partie: Partie; parties: Partie[]; sortie: boolean; verrouille: boolean; recharger: () => Promise<void> }) {
  const [prenom, setPrenom] = useState(p.prenom);
  const [nom, setNom] = useState(p.nom);
  const [email, setEmail] = useState(p.email ?? '');
  const [telephone, setTelephone] = useState(p.telephone ?? '');
  const [adresse, setAdresse] = useState(p.adresse ?? '');
  const [nouvelleAdresse, setNouvelleAdresse] = useState(p.nouvelle_adresse ?? '');
  const [represente, setRepresente] = useState(p.represente_id ?? '');
  const [present, setPresent] = useState(p.doit_signer);
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const mandataire = p.role === 'mandataire_bailleur' || p.role === 'mandataire_locataire';
  const representables = parties.filter((x) => x.role === (p.role === 'mandataire_bailleur' ? 'bailleur' : 'locataire'));
  const k = p.id;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return setRetour({ ton: 'erreur', texte: 'Indiquez le nom, ou la dénomination de la société.' });
    if (email.trim() && !emailValide(email)) return setRetour({ ton: 'erreur', texte: 'Cette adresse e-mail n’est pas valide.' });
    setOccupe(true);
    await local.modifier('edl_parties', p.id, {
      prenom: prenom.trim(), nom: nom.trim(), email: email.trim() || null, telephone: telephone.trim() || null,
      adresse: adresse.trim() || null, nouvelle_adresse: nouvelleAdresse.trim() || null,
      doit_signer: present, ...(mandataire ? { represente_id: represente } : {}),
    }, ROLES[p.role]);
    setOccupe(false);
    setRetour({ ton: 'succes', texte: 'Enregistré.' });
    await recharger();
  }

  return (
    <Carte>
      <h2 className="text-lg font-bold">{ROLES[p.role]}{p.nom ? ` · ${nomComplet(p)}` : ''}</h2>
      <form onSubmit={envoyer} className="flex flex-col gap-3" noValidate>
        <fieldset disabled={verrouille} className="flex flex-col gap-3">
          {mandataire && (
            <Liste id={`rep-${k}`} libelle="Représente" value={represente} onChange={(e) => setRepresente(e.target.value)}>
              {representables.map((x) => <option key={x.id} value={x.id}>{nomComplet(x) || ROLES[x.role]}</option>)}
            </Liste>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Champ id={`prenom-${k}`} libelle="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
            <Champ id={`nom-${k}`} libelle="Nom ou société" value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
          <Champ id={`email-${k}`} libelle="E-mail" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aide="Pour recevoir le PDF signé." />
          <Champ id={`tel-${k}`} libelle="Téléphone" type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          {p.role !== 'locataire' && <Champ id={`adresse-${k}`} libelle="Adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} />}
          {p.role === 'locataire' && sortie && (
            <Champ id={`nouvelle-${k}`} libelle="Nouvelle adresse du locataire" value={nouvelleAdresse} onChange={(e) => setNouvelleAdresse(e.target.value)} aide="Mention obligatoire de l’état des lieux de sortie." />
          )}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={present} onChange={(e) => setPresent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--marque))]" />
            <span>Présent le jour de l’état des lieux : sa signature sera demandée.</span>
          </label>
          {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
          {!verrouille && (
            <div className="grid grid-cols-2 gap-3">
              <Bouton variante="contour" className="!border-hs !text-hs" onClick={async () => { await local.supprimer('edl_parties', p.id, ROLES[p.role]); await recharger(); }}>Retirer</Bouton>
              <Bouton type="submit" occupe={occupe}>Enregistrer</Bouton>
            </div>
          )}
        </fieldset>
      </form>
    </Carte>
  );
}
