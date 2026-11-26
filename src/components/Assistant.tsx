import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FONCTIONNEMENT, chercher, indexer, type Fiche } from '../lib/assistant';

/** Constant, le personnage de l'assistant : un visage rond coiffé d'une casquette aux couleurs du site. */
function Visage({ taille = 44 }: { taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="26" r="17" fill="#fde8cf" />
      <path d="M7 22c0-10 7.6-17 17-17s17 7 17 17c-5-3.6-11-5-17-5s-12 1.4-17 5z" fill="#0f4c4a" />
      <path d="M6 22.500c6-4 12-5.5 18-5.500s12 1.5 18 5.500c.8.5.3 1.8-.7 1.600C35.5 22.8 30 22 24 22s-11.5.8-17.3 2.100c-1 .2-1.5-1.1-.7-1.600z" fill="#f4b61a" />
      <circle cx="17.5" cy="28" r="2.2" fill="#0f2e2e" /><circle cx="30.5" cy="28" r="2.2" fill="#0f2e2e" />
      <circle cx="13.5" cy="33" r="2.6" fill="#f6b8a0" opacity=".7" /><circle cx="34.5" cy="33" r="2.6" fill="#f6b8a0" opacity=".7" />
      <path d="M18 34.500c1.8 2.3 3.8 3.3 6 3.300s4.2-1 6-3.3" fill="none" stroke="#0f2e2e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface Message { de: 'vous' | 'constant'; texte: string; fiche?: Fiche; autres?: Fiche[] }
const ACCUEIL: Message = { de: 'constant', texte: 'Bonjour, je suis Constant. Posez-moi une question sur l’état des lieux, le dépôt de garantie ou le fonctionnement de Constatio.' };
const IDEES = ['Combien ça coûte ?', 'Ça marche sans réseau ?', 'Délai pour rendre le dépôt de garantie ?', 'Comment faire signer le locataire ?'];
const lien = 'font-semibold text-marque underline underline-offset-4';

/** Bulle d'aide en bas de l'écran. Les réponses viennent des guides et d'une liste rédigée : rien n'est inventé, rien n'est envoyé. */
export function Assistant() {
  const { pathname } = useLocation();
  const [ouvert, setOuvert] = useState(false);
  const [guides, setGuides] = useState<Fiche[]>([]);
  const [messages, setMessages] = useState<Message[]>([ACCUEIL]);
  const [saisie, setSaisie] = useState('');
  const fil = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const index = useMemo(() => indexer([...FONCTIONNEMENT, ...guides]), [guides]);

  // Les questions des guides ne sont chargées qu'à la première ouverture.
  useEffect(() => {
    if (!ouvert || guides.length) return;
    fetch('/assistant.json').then((r) => (r.ok ? r.json() : [])).then((d) => Array.isArray(d) && setGuides(d)).catch(() => undefined);
  }, [ouvert, guides.length]);
  useEffect(() => { if (ouvert) champ.current?.focus(); }, [ouvert]);
  useEffect(() => { fil.current?.scrollTo({ top: fil.current.scrollHeight }); }, [messages, ouvert]);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    window.addEventListener('keydown', fermer);
    return () => window.removeEventListener('keydown', fermer);
  }, [ouvert]);

  // Pas sur la page où une partie signe, ni dans l'administration ; pendant la visite d'une pièce, il gênerait la saisie.
  if (/^\/(signer|admin|passage)/.test(pathname) || /^\/app\/edl\/[^/]+\/./.test(pathname)) return null;
  const dansApp = pathname.startsWith('/app');

  function demander(question: string) {
    const q = question.trim();
    if (!q) return;
    const trouves = chercher(index, q);
    const reponse: Message = trouves.length
      ? { de: 'constant', texte: trouves[0].fiche.r, fiche: trouves[0].fiche, autres: trouves.slice(1).map((t) => t.fiche) }
      : { de: 'constant', texte: 'Je n’ai pas de réponse sûre à cette question, et je préfère ne pas en inventer. Essayez avec d’autres mots, consultez les guides, ou écrivez-nous à bonjour@signabail.fr.' };
    setMessages((m) => [...m, { de: 'vous', texte: q }, reponse]);
    setSaisie('');
  }
  const envoyer = (e: FormEvent) => { e.preventDefault(); demander(saisie); };
  const versFiche = (f: Fiche) => (f.url?.startsWith('/guides') ? <a href={f.url} className={lien}>{f.source ?? 'Lire le guide'}</a> : f.url ? <Link to={f.url} className={lien} onClick={() => setOuvert(false)}>{f.source ?? 'Voir'}</Link> : null);

  return (
    <div className={`fixed right-3 z-30 flex flex-col items-end gap-2 print:hidden ${dansApp ? 'bottom-20' : 'bottom-3'}`}>
      {ouvert && (
        <section role="dialog" aria-label="Assistant Constatio" className="flex max-h-[min(34rem,calc(100dvh-7rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-trait bg-surface shadow-2xl" data-testid="assistant">
          <header className="flex items-center gap-2 bg-marque px-3 py-2 text-sur-marque">
            <span className="rounded-full bg-surface"><Visage taille={36} /></span>
            <span className="min-w-0 flex-1"><span className="block font-bold leading-tight">Constant</span><span className="block text-xs opacity-90">Assistant Constatio</span></span>
            <button type="button" onClick={() => setOuvert(false)} aria-label="Fermer l’assistant" className="h-9 w-9 rounded-full text-xl leading-none hover:bg-white/15">×</button>
          </header>
          <div ref={fil} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={m.de === 'vous' ? 'max-w-[85%] self-end rounded-2xl rounded-br-sm bg-marque px-3 py-2 text-sur-marque' : 'max-w-[92%] self-start rounded-2xl rounded-bl-sm bg-creux px-3 py-2'} data-testid={m.de === 'constant' ? 'reponse' : undefined}>
                {m.fiche && <p className="mb-1 font-semibold">{m.fiche.q}</p>}
                <p>{m.texte}</p>
                {m.fiche && versFiche(m.fiche) && <p className="mt-1">{versFiche(m.fiche)}</p>}
                {m.autres && m.autres.length > 0 && (
                  <div className="mt-2 border-t border-trait pt-2">
                    <p className="text-xs text-discret">Voir aussi</p>
                    {m.autres.map((f) => <button key={f.q} type="button" className={`block text-left ${lien}`} onClick={() => demander(f.q)}>{f.q}</button>)}
                  </div>
                )}
              </div>
            ))}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {IDEES.map((q) => <button key={q} type="button" onClick={() => demander(q)} className="rounded-full border border-marque px-3 py-1 text-left text-sm font-semibold text-marque">{q}</button>)}
              </div>
            )}
          </div>
          <form onSubmit={envoyer} className="flex gap-2 border-t border-trait p-2">
            <label htmlFor="question-assistant" className="sr-only">Votre question</label>
            <input id="question-assistant" ref={champ} value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Votre question…" autoComplete="off" maxLength={200}
              className="min-w-0 flex-1 rounded-xl border border-trait bg-surface px-3 py-2 text-base" />
            <button type="submit" disabled={!saisie.trim()} className="rounded-xl bg-marque px-4 font-semibold text-sur-marque disabled:opacity-50">Envoyer</button>
          </form>
          <p className="border-t border-trait px-3 py-1.5 text-[0.7rem] leading-snug text-discret">Information générale tirée de nos guides ; elle ne remplace pas un conseil juridique. Vos questions restent sur votre appareil.</p>
        </section>
      )}
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} aria-label={ouvert ? 'Fermer l’assistant' : 'Poser une question à Constant, l’assistant'}
        className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-marque bg-surface shadow-xl transition-transform hover:scale-105 motion-reduce:transition-none" data-testid="bulle-assistant">
        <Visage />
      </button>
    </div>
  );
}
