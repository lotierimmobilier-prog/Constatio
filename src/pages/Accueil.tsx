import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BandeauModeTest } from '../components/BandeauModeTest';
import { DemoVisite } from '../components/site/DemoVisite';
import { Logo, classesBouton } from '../components/ui';
import { ETATS } from '../lib/trame';

/** Une section : la référence ou la note en marge, le contenu à côté. Sur téléphone, la note passe au-dessus. */
function Section({ id, marge, titre, chapeau, children }: { id: string; marge?: string; titre: string; chapeau?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-20 border-t border-trait py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-3 px-4 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <p className="text-sm leading-relaxed text-discret lg:pt-3">{marge}</p>
        <div className="min-w-0">
          <h2 id={`${id}-titre`} className="max-w-3xl text-[2rem] font-bold leading-[1.1] sm:text-[2.75rem]">{titre}</h2>
          {chapeau && <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-discret">{chapeau}</p>}
          <div className="mt-10">{children}</div>
        </div>
      </div>
    </section>
  );
}

const PROFILS = [
  { titre: 'Vous louez en votre nom', texte: 'Un appartement ou une maison, vide ou meublé. Vous faites l’état des lieux vous-même, sans rien oublier de ce que la loi exige.' },
  { titre: 'Vous louez par une SCI', texte: 'La société et son gérant figurent en tête du document. Tous vos logements et leurs états des lieux successifs sont au même endroit.' },
  { titre: 'Vous gérez pour d’autres', texte: 'Agence, gestionnaire, conciergerie : plusieurs agents, vos documents à votre en-tête, et l’export vers votre logiciel de gestion.' },
];

const ETAPES = [
  { titre: 'Vous visitez pièce par pièce', texte: 'Un appui par élément, une photo, une observation dictée. Le logement est décrit avant que le locataire ait fini de faire le tour.' },
  { titre: 'Vous relisez les contrôles', texte: 'Compteur non relevé, clé non décrite, meublé incomplet : chaque alerte vous ramène à l’endroit à compléter.' },
  { titre: 'Chacun signe sur place', texte: 'Bailleur et locataire signent sur l’écran, ou à distance. Chacun reçoit le PDF, et plus rien n’est modifiable.' },
];

const CONTROLES: [string, string, string][] = [
  ['Décret n° 2016-382, art. 2', 'Mentions obligatoires', 'Type et date, adresse, parties et mandataires, relevés, clés, description pièce par pièce, signatures.'],
  ['Décret n° 2016-382, art. 2', 'Compteurs', 'Électricité, gaz, eau froide et eau chaude : chacun est relevé, ou déclaré absent. Jamais laissé vide.'],
  ['Décret n° 2015-981, art. 2', 'Inventaire du meublé', 'Les onze équipements obligatoires sont pointés un par un ; celui qui manque est nommé.'],
  ['Art. 3-2, loi de 1989', 'Complément d’état des lieux', 'Le locataire peut le demander pendant dix jours, et pour le chauffage pendant le premier mois de chauffe.'],
  ['Art. 3-2, loi de 1989', 'Sortie', 'Nouvelle adresse du locataire et date de l’état des lieux d’entrée, exigées en sortie.'],
  ['Art. 22, loi de 1989', 'Dépôt de garantie', 'Délai de restitution d’un ou deux mois calculé, vétusté déduite, retenues justifiées ligne par ligne.'],
];

/** Ce que risque un bailleur dont l'état des lieux est absent ou mal fait. Textes à faire relire par un avocat avant mise en ligne. */
const RISQUES = [
  { cause: 'État des lieux de sortie absent ou imprécis', consequence: 'Un dépôt de garantie à rendre en entier',
    texte: 'C’est au bailleur de prouver les dégradations. « Bon état général » à l’entrée et « à rafraîchir » à la sortie ne prouvent rien : sans description précise des deux côtés, la retenue ne tient pas.',
    reference: 'Art. 7 c et 22, loi du 6 juillet 1989', parade: 'Même trame à l’entrée et à la sortie, un état par élément, les écarts affichés côte à côte avec les photos.' },
  { cause: 'Dépôt de garantie rendu en retard', consequence: '10 % du loyer par mois de retard',
    texte: 'Le dépôt se rend dans le mois si la sortie est conforme à l’entrée, dans les deux mois sinon. Passé ce délai, chaque mois de retard commencé coûte 10 % du loyer mensuel.',
    reference: 'Art. 22, loi de 1989', parade: 'Date limite calculée à la remise des clés, décompte et courrier au locataire préparés.' },
  { cause: 'Vétusté non prise en compte', consequence: 'Une retenue contestée devant le juge',
    texte: 'Le locataire ne répond pas de l’usure normale. Lui facturer une peinture de dix ans au prix du neuf, c’est s’exposer à devoir tout rembourser.',
    reference: 'Art. 7 d, loi de 1989 ; décret n° 2016-382, art. 4', parade: 'Grille de vétusté appliquée à chaque retenue, par défaut ou la vôtre.' },
  { cause: 'Inventaire du mobilier absent ou incomplet', consequence: 'Un meublé requalifié en location vide',
    texte: 'Sans les onze équipements exigés, le logement n’est pas un meublé. Le locataire peut demander au juge d’appliquer les règles de la location vide : bail de trois ans, préavis allongé.',
    reference: 'Art. 25-4 et 25-5, loi de 1989 ; décret n° 2015-981', parade: 'Inventaire pointé avec l’état des lieux ; l’équipement manquant bloque le document.' },
  { cause: 'État des lieux fait seul, sans le locataire', consequence: 'Un document sans valeur contre lui',
    texte: 'L’état des lieux est contradictoire : il se fait en présence des deux parties ou de leurs mandataires. Si l’une refuse, il faut un commissaire de justice, à frais partagés.',
    reference: 'Art. 3-2, loi de 1989', parade: 'Parties, mandataires et procurations identifiés ; mise en relation avec un commissaire de justice en cas de refus.' },
  { cause: 'Photos sans date ni lieu', consequence: 'Des preuves que l’on peut écarter',
    texte: 'Une photo prise « avant » ne prouve rien si rien n’établit quand ni où elle a été prise. Elle doit être rattachée à l’état des lieux signé.',
    reference: 'Pratique des tribunaux', parade: 'Photos horodatées et géolocalisées, rattachées à chaque élément, figées à la signature.' },
];

const TARIFS: [string, string, string][] = [
  ['État des lieux à l’unité', 'Entrée, sortie ou relevé d’état', '14,90 €'],
  ['Pack entrée + sortie', 'Les deux états des lieux d’une même location', '24,90 €'],
  ['Pack 5 crédits', 'Valables 24 mois', '59 €'],
  ['Pack 10 crédits', 'Valables 24 mois', '99 €'],
  ['Bail Signabail + entrée + sortie', 'Le bail et ses deux états des lieux', '34,90 €'],
  ['Premium Investisseur', '12 états des lieux par an, relevés d’état illimités, historique par logement', '9,90 € / mois'],
  ['Premium Pro', 'Plusieurs utilisateurs, documents à votre en-tête, export vers votre logiciel', '39,90 € / mois'],
];

const FAQ = [
  ['Un état des lieux fait sur téléphone a-t-il la même valeur qu’un état des lieux papier ?', 'Oui. La loi autorise expressément la forme électronique. Ce qui compte, c’est qu’il soit établi contradictoirement, qu’il contienne les mentions du décret du 30 mars 2016 et que chaque partie en reçoive un exemplaire signé.'],
  ['Que se passe-t-il s’il n’y a pas de réseau dans le logement ?', 'Vous continuez. Tout ce que vous saisissez est gardé sur le téléphone et envoyé dès que le réseau revient. Vous pouvez faire une visite entière dans une cave.'],
  ['Le locataire doit-il créer un compte ?', 'Non. Il signe sur votre écran, ou depuis un lien reçu par e-mail. Il reçoit ensuite son exemplaire en PDF.'],
  ['Quand est-ce que je paie ?', 'Au moment de générer le document définitif. Le brouillon est gratuit : vous pouvez préparer tout l’état des lieux avant de payer.'],
  ['Le locataire peut-il contester après avoir signé ?', 'Il peut demander à compléter l’état des lieux d’entrée dans les dix jours, et pour le chauffage pendant le premier mois de la période de chauffe. Constatio enregistre sa demande et votre réponse.'],
  ['Et si le locataire refuse de signer ?', 'L’état des lieux est alors établi par un commissaire de justice, à frais partagés par moitié entre le bailleur et le locataire. Constatio vous indique la marche à suivre.'],
];

export function Accueil() {
  const { session } = useAuth();
  const commencer = session ? '/app' : '/inscription';
  const lien = 'text-sm font-semibold text-encre underline-offset-4 hover:underline';
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <BandeauModeTest />
      <header className="sticky top-0 z-10 border-b border-trait bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
            <a href="#etapes" className={lien}>Fonctionnement</a>
            <a href="#controles" className={lien}>Conformité</a>
            <a href="#tarifs" className={lien}>Tarifs</a>
            <a href="#agent" className={lien}>Par un agent</a>
            <a href="#faq" className={lien}>Questions</a>
            <a href="/guides/" className={lien}>Guides</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link to={session ? '/app' : '/connexion'} className={lien}>{session ? 'Mon espace' : 'Connexion'}</Link>
            <Link to={commencer} className={`${classesBouton('plein')} hidden !min-h-[40px] !w-auto !text-sm sm:inline-flex`}>Commencer</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Ouverture : la promesse, et la visite elle-même à essayer. */}
        <section id="ouverture">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pb-24 lg:pt-20">
            <div>
              <h1 className="text-[2.5rem] font-bold leading-[1.04] sm:text-[3.9rem]">
                Un état des lieux <span className="bg-[linear-gradient(transparent_62%,rgb(var(--repere))_62%,rgb(var(--repere))_92%,transparent_92%)]">incontestable</span> en 20 minutes, depuis votre téléphone.
              </h1>
              <p className="mt-8 max-w-[56ch] text-lg leading-relaxed text-discret">
                Vous faites le tour du logement, un appui par élément. Constatio relève ce que le décret exige, horodate les photos, fait signer sur place et garde la preuve. À la sortie, il compare avec l’entrée et chiffre les retenues.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link to={commencer} className={`${classesBouton('repere')} whitespace-nowrap sm:!w-auto sm:px-6`}>Faire mon état des lieux gratuitement</Link>
                <a href="#etapes" className={`${classesBouton('contour')} whitespace-nowrap sm:!w-auto sm:px-6`}>Voir comment ça marche</a>
              </div>
              <p className="mt-5 text-sm text-discret">Brouillon gratuit, sans carte bancaire. Vous ne payez qu’à la génération du document définitif : 14,90 €, sans abonnement.</p>
            </div>
            <div>
              <DemoVisite />
              <p className="mt-3 text-center text-sm text-discret">Essayez : touchez un état, les contrôles réagissent.</p>
            </div>
          </div>
          <dl className="mx-auto grid max-w-6xl gap-x-10 gap-y-5 border-t border-trait px-4 py-8 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <div><dt className="text-discret">Textes appliqués</dt><dd className="mt-0.5 font-semibold">Loi du 6 juillet 1989, décret du 30 mars 2016</dd></div>
            <div><dt className="text-discret">Sans réseau</dt><dd className="mt-0.5 font-semibold">La visite continue, l’envoi suit</dd></div>
            <div><dt className="text-discret">Signature</dt><dd className="mt-0.5 font-semibold">Électronique, dossier de preuve horodaté</dd></div>
            <div><dt className="text-discret">Données</dt><dd className="mt-0.5 font-semibold">Hébergées dans l’Union européenne</dd></div>
          </dl>
        </section>

        <Section id="profils" marge="Le document s’adapte à qui le signe." titre="Fait pour celui qui loue, et pour celui qui gère.">
          <ul className="grid gap-y-8 md:grid-cols-3 md:divide-x md:divide-trait">
            {PROFILS.map((p) => (
              <li key={p.titre} className="md:px-8 md:first:pl-0 md:last:pr-0">
                <h3 className="text-xl font-bold">{p.titre}</h3>
                <p className="mt-3 leading-relaxed text-discret">{p.texte}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="etapes" marge="Brouillon gratuit jusqu’à l’étape 3." titre="Trois étapes, dans le logement.">
          <ol className="grid gap-10 md:grid-cols-3">
            {ETAPES.map((e, i) => (
              <li key={e.titre}>
                <p className="font-titre text-5xl font-bold leading-none text-marque">{i + 1}</p>
                <h3 className="mt-3 text-xl font-bold">{e.titre}</h3>
                <p className="mt-2 leading-relaxed text-discret">{e.texte}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 rounded-2xl bg-fond p-5 sm:p-6">
            <p className="font-semibold">Cinq états, une lettre et une couleur : lisible en plein soleil, utilisable d’une main.</p>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
              {ETATS.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className={`grid h-9 w-11 place-items-center rounded-lg text-sm font-bold text-surface ${x.classe}`}>{x.court}</span>
                  <span>{x.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="controles" marge="Les mêmes contrôles que dans l’application." titre="Ce qu’un formulaire papier ne vérifiera jamais." chapeau="Constatio connaît les mentions obligatoires. Il ne vous laisse pas générer un état des lieux auquel il en manque une.">
          <dl className="border-t-2 border-encre">
            {CONTROLES.map(([ref, t, d]) => (
              <div key={t} className="grid gap-1 border-b border-trait py-4 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-8">
                <dt className="text-sm text-discret sm:pt-1">{ref}</dt>
                <dd><span className="font-titre text-lg font-bold">{t}.</span> <span className="text-discret">{d}</span></dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="risques" marge="Chaque risque est contrôlé dans l’application, avant la signature." titre="Ce que coûte un état des lieux mal fait."
          chapeau="Un état des lieux bâclé ne se voit pas le jour de l’entrée. Il se découvre au départ du locataire, quand il faut justifier une retenue, et c’est le bailleur qui paie.">
          <ol className="border-t-2 border-encre">
            {RISQUES.map((r, i) => (
              <li key={r.consequence} className="grid gap-3 border-b border-trait py-7 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-10">
                <div>
                  <p className="text-sm text-discret"><span className="mr-3 font-bold tabular-nums text-marque">{String(i + 1).padStart(2, '0')}</span>{r.cause}</p>
                  <h3 className="mt-1 text-2xl font-bold leading-snug">{r.consequence}</h3>
                  <p className="mt-2 max-w-[66ch] leading-relaxed text-discret">{r.texte}</p>
                  <p className="mt-2 text-xs text-discret">{r.reference}</p>
                </div>
                <p className="text-sm leading-relaxed md:pt-7"><span className="font-semibold text-marque">Dans Constatio.</span> <span className="text-discret">{r.parade}</span></p>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to={commencer} className={`${classesBouton('plein')} !w-auto px-6`}>Faire un état des lieux conforme</Link>
            <span className="text-sm text-discret">Brouillon gratuit et contrôlé, sans carte bancaire.</span>
          </div>
        </Section>

        <Section id="comparatif" titre="Entre le formulaire papier et le professionnel.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[0.95rem]">
              <caption className="sr-only">Constatio comparé à un formulaire papier et à un professionnel</caption>
              <thead>
                <tr className="border-b-2 border-encre">
                  <th scope="col" className="py-3 pr-4"><span className="sr-only">Critère</span></th>
                  <th scope="col" className="px-4 py-3 font-titre text-lg text-marque">Constatio</th>
                  <th scope="col" className="px-4 py-3 font-titre text-lg font-medium">Formulaire papier</th>
                  <th scope="col" className="px-4 py-3 font-titre text-lg font-medium">Agence ou commissaire de justice</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Prix', '14,90 € l’état des lieux', 'Gratuit', 'Au m², ou tarif réglementé'],
                  ['Mentions obligatoires vérifiées', 'À chaque étape', 'Non', 'Oui'],
                  ['Photos datées, rattachées au document', 'Oui', 'Non', 'Selon le prestataire'],
                  ['Comparaison entrée / sortie', 'Automatique', 'À la main', 'Selon le prestataire'],
                  ['Vétusté et décompte du dépôt', 'Calculés', 'Non', 'Rarement'],
                  ['Délai', '20 minutes, quand vous voulez', 'Variable', 'Sur rendez-vous'],
                ].map(([c, a, b, d]) => (
                  <tr key={c} className="border-b border-trait">
                    <th scope="row" className="py-3.5 pr-4 font-medium">{c}</th>
                    <td className="bg-fond px-4 py-3.5 font-semibold">{a}</td>
                    <td className="px-4 py-3.5 text-discret">{b}</td>
                    <td className="px-4 py-3.5 text-discret">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="tarifs" marge="Prix TTC, TVA de 20 % comprise." titre="Payez à l’état des lieux, ou abonnez-vous." chapeau="Le brouillon est gratuit ; un crédit n’est consommé qu’à la génération du document définitif.">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Barème des tarifs</caption>
            <tbody className="border-t-2 border-encre">
              {TARIFS.map(([nom, detail, prix]) => (
                <tr key={nom} className="border-b border-trait align-baseline">
                  <th scope="row" className="py-4 pr-4 font-normal">
                    <span className="block font-titre text-lg font-bold">{nom}</span>
                    <span className="block text-sm text-discret">{detail}</span>
                  </th>
                  <td className="whitespace-nowrap py-4 text-right font-titre text-xl font-bold tabular-nums">{prix}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-6 max-w-[66ch] text-sm text-discret">À l’unité et en pack, vos documents portent la mention « Réalisé avec Constatio — partenaire Signabail » ; avec le Premium Pro, ils sont à votre en-tête. Les abonnés Signabail bénéficient de 20 % de remise sur leur abonnement Constatio.</p>
        </Section>

        <Section id="signabail" marge="Deux services indépendants, un seul compte si vous le souhaitez." titre="Votre bail est signé ? L’état des lieux est déjà prêt.">
          <div className="grid gap-8 md:grid-cols-2">
            <p className="max-w-[58ch] text-lg leading-relaxed text-discret">
              Constatio est le service partenaire de Signabail, qui rédige et fait signer vos baux. Avec chaque bail d’habitation signé sur Signabail, un état des lieux d’entrée vous est offert sur Constatio : bailleur, locataires, adresse et pièces y sont déjà reportés.
            </p>
            <ul className="flex flex-col gap-3 border-t border-trait pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              <li><span className="font-semibold">Un état des lieux d’entrée offert</span> <span className="text-discret">avec chaque bail d’habitation Signabail.</span></li>
              <li><span className="font-semibold">Import du bail en un geste</span> <span className="text-discret">: rien à ressaisir.</span></li>
              <li><span className="font-semibold">Bail + entrée + sortie à 34,90 €</span> <span className="text-discret">au lieu de 44,80 €.</span></li>
              <li><a href="https://signabail.fr" className="font-semibold text-marque underline underline-offset-4">Pas encore de bail ? Rédigez-le sur Signabail</a></li>
            </ul>
          </div>
        </Section>

        <Section id="agent" marge="Béziers, Montpellier, Nîmes, Avignon, Narbonne, Carcassonne, Capendu et Trèbes." titre="Vous ne pouvez pas vous déplacer ? Un agent s’en charge.">
          <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="max-w-[60ch] text-lg leading-relaxed text-discret">
              <p>Un agent de LOTIER, agence immobilière titulaire de la carte professionnelle, réalise l’état des lieux sur place avec Constatio. Vous recevez le même document, signé par le locataire.</p>
              <p className="mt-4 text-base">Pour un état des lieux d’entrée, la part facturée au locataire est plafonnée par la loi : au plus 3 € par m² de surface habitable, et jamais plus que la part du bailleur. L’état des lieux de sortie n’est jamais facturé au locataire.</p>
            </div>
            <div className="rounded-2xl border-2 border-encre p-5">
              <p className="text-sm text-discret">Forfait, quelle que soit la surface</p>
              <p className="font-titre text-4xl font-bold tabular-nums">180 € <span className="text-base font-medium">TTC</span></p>
              <p className="mt-3 text-sm text-discret">Réservation d’un créneau en ligne, bientôt disponible.</p>
            </div>
          </div>
        </Section>

        <Section id="faq" titre="Les questions qu’on nous pose.">
          <div className="border-t-2 border-encre">
            {FAQ.map(([q, r]) => (
              <details key={q} className="group border-b border-trait py-4">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 font-titre text-lg font-bold [&::-webkit-details-marker]:hidden">
                  {q}<span aria-hidden="true" className="text-xl text-marque group-open:hidden">+</span><span aria-hidden="true" className="hidden text-xl text-marque group-open:inline">–</span>
                </summary>
                <p className="mt-3 max-w-[68ch] leading-relaxed text-discret">{r}</p>
              </details>
            ))}
          </div>
        </Section>

        <section id="fin" className="border-t border-trait bg-marque py-16 text-sur-marque sm:py-20">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="max-w-2xl text-[2rem] font-bold leading-[1.1] sm:text-[2.75rem]">Dans vingt minutes, votre état des lieux est signé.</h2>
              <p className="mt-3 max-w-[56ch] text-lg opacity-85">Commencez maintenant : le brouillon est gratuit et sans carte bancaire.</p>
            </div>
            <Link to={commencer} className={`${classesBouton('repere')} md:!w-auto md:px-7`}>Faire mon état des lieux</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-trait bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-discret sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>Service partenaire de Signabail — conçu par LOTIER, 40 rue Française, 34500 Béziers.</p>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
<a href="/guides/" className="underline underline-offset-4">Guides</a><Link to="/cgv" className="underline underline-offset-4">Conditions générales</Link><Link to="/mentions-legales" className="underline underline-offset-4">Mentions légales</Link><Link to="/confidentialite" className="underline underline-offset-4">Confidentialité et cookies</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
