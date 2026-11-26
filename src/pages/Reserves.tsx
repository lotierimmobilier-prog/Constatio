import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Alerte, Bouton, Carte, Logo } from '../components/ui';
import { STATUTS_RESERVE, instant } from '../lib/reserves';
import { supabase } from '../lib/supabase';

interface Dossier { adresse: string; date_edl: string; limite: string; ouvert: boolean; locataire: string; reserves: { texte: string; statut: 'demande' | 'accepte' | 'refuse'; reponse: string | null; depose_le: string }[] }

/** Page ouverte par le lien de réserves : le locataire signale, sans compte, ce qui manque à l'état des lieux d'entrée. */
export function Reserves() {
  const { jeton } = useParams();
  const [dossier, setDossier] = useState<Dossier | null | undefined>(undefined);
  const [texte, setTexte] = useState('');
  const [retour, setRetour] = useState<{ ton: 'erreur' | 'succes'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const charger = useCallback(async () => { setDossier(((await supabase.rpc('reserves_consulter', { p_jeton: jeton })).data as Dossier | null) ?? null); }, [jeton]);
  useEffect(() => { void charger(); }, [charger]);

  async function deposer(e: FormEvent) {
    e.preventDefault();
    setOccupe(true); setRetour(null);
    const { error } = await supabase.rpc('reserves_deposer', { p_jeton: jeton, p_texte: texte });
    setOccupe(false);
    if (error) return setRetour({ ton: 'erreur', texte: error.code === 'P0001' ? error.message : 'Votre réserve n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.' });
    setTexte('');
    setRetour({ ton: 'succes', texte: 'Réserve enregistrée. Votre bailleur en est informé à l’ouverture de son espace ; sa réponse apparaîtra ici.' });
    await charger();
  }

  return (
    <div className="min-h-dvh bg-fond">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <Logo />
        {dossier === undefined && <p className="text-center text-discret">Chargement…</p>}
        {dossier === null && <Alerte>Ce lien n’est pas valable. Demandez-en un nouveau à la personne qui a réalisé l’état des lieux.</Alerte>}
        {dossier && (
          <>
            <div>
              <h1 className="text-2xl font-bold">Compléter l’état des lieux</h1>
              <p className="text-sm text-discret">{dossier.adresse} · état des lieux d’entrée du {new Date(dossier.date_edl).toLocaleDateString('fr-FR')}</p>
            </div>
            <Carte>
              <p className="font-semibold" data-testid="locataire">{dossier.locataire}</p>
              <p className="text-sm">Vous avez dix jours pour signaler ce que l’état des lieux d’entrée n’a pas relevé (loi du 6 juillet 1989, article 3-2). {dossier.ouvert ? `Jusqu’au ${instant(dossier.limite)}.` : `Ce délai s’est achevé le ${instant(dossier.limite)}.`}</p>
              {retour && <Alerte ton={retour.ton}>{retour.texte}</Alerte>}
              {dossier.ouvert && (
                <form onSubmit={deposer} className="flex flex-col gap-3" noValidate>
                  <label htmlFor="reserve" className="font-semibold">Votre réserve</label>
                  <textarea id="reserve" rows={4} value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={2000} placeholder="Pièce, élément, ce que vous constatez…" className="w-full rounded-xl border border-trait bg-surface px-3 py-2 text-base" />
                  <p className="text-sm text-discret">Une réserve par constat. Soyez précis : pièce, élément, défaut.</p>
                  <Bouton type="submit" disabled={occupe || texte.trim().length < 5}>{occupe ? 'Envoi…' : 'Déposer cette réserve'}</Bouton>
                </form>
              )}
            </Carte>
            <Carte>
              <h2 className="font-bold">Vos réserves</h2>
              {dossier.reserves.length === 0 ? <p className="text-sm text-discret">Aucune pour l’instant.</p> : (
                <ul className="flex flex-col gap-3">
                  {dossier.reserves.map((r, i) => (
                    <li key={i} className="flex flex-col gap-1 border-t border-trait pt-2 text-sm" data-testid="ma-reserve">
                      <span className="flex justify-between gap-3 text-discret"><span>Le {instant(r.depose_le)}</span><span className={`font-semibold ${r.statut === 'accepte' ? 'text-neuf' : r.statut === 'refuse' ? 'text-hs' : ''}`}>{STATUTS_RESERVE[r.statut]}</span></span>
                      <span className="text-base">{r.texte}</span>
                      {r.reponse && <span>Réponse du bailleur : {r.reponse}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Carte>
          </>
        )}
      </main>
    </div>
  );
}
