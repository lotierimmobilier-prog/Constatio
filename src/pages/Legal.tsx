import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';
import { EDITEUR as e } from '../lib/editeur';

// Pages légales. Chaque affirmation de la politique de confidentialité décrit ce que
// fait réellement le code : la modifier quand un traitement change.
// Textes à faire relire par un juriste (voir docs) : rédigés pour décrire fidèlement ce que fait le service.
const MAJ = '26 novembre 2026';
const ecrire = <a href={`mailto:${e.email}`}>{e.email}</a>;

export function LiensLegaux({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Informations légales" className={`flex flex-wrap gap-x-5 gap-y-1 ${className}`}>
      <Link to="/mentions-legales" className="underline underline-offset-4">Mentions légales</Link>
      <Link to="/cgv" className="underline underline-offset-4">Conditions générales</Link>
      <Link to="/confidentialite" className="underline underline-offset-4">Confidentialité et cookies</Link>
    </nav>
  );
}

function PageLegale({ titre, chapeau, children }: { titre: string; chapeau: string; children: ReactNode }) {
  useEffect(() => { document.title = `${titre} — Constatio`; window.scrollTo(0, 0); }, [titre]);
  return (
    <div className="min-h-dvh bg-fond">
      <header className="border-b border-trait bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <Link to="/" className="text-sm font-semibold text-marque">← Accueil</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-bold leading-tight">{titre}</h1>
        <p className="mt-2 text-sm text-discret">{chapeau}</p>
        <div className="mt-6 flex flex-col gap-3 leading-relaxed [&_a]:font-semibold [&_a]:text-marque [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          {children}
        </div>
      </main>
      <footer className="border-t border-trait bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-discret"><LiensLegaux /></div>
      </footer>
    </div>
  );
}

export function MentionsLegales() {
  return (
    <PageLegale titre="Mentions légales" chapeau={`Dernière mise à jour : ${MAJ}.`}>
      <h2>Éditeur</h2>
      <p>Le site constatio.fr et le service Constatio sont édités par <strong>{e.nom}</strong>, {e.qualite}, {e.forme} au capital de {e.capital}, immatriculée sous le numéro {e.rcs}, dont le siège est situé {e.adresse}.</p>
      <ul>
        <li>SIRET : {e.siret}</li>
        <li>N° de TVA intracommunautaire : {e.tva}</li>
        <li>Téléphone : {e.telephone} · e-mail : {ecrire}</li>
        <li>Directeur de la publication : {e.directeurPublication}</li>
      </ul>
      <h2>Activité immobilière</h2>
      <p>{e.nom} exerce également, sous l’enseigne {e.enseigne}, une activité d’agent immobilier régie par la loi n° 70-9 du 2 janvier 1970 (loi Hoguet) : carte professionnelle n° {e.cartePro} délivrée par la {e.carteProAutorite}. Garantie financière : {e.garantieFinanciere}. Assurance de responsabilité civile professionnelle : {e.assuranceRcp}. Site de l’agence : <a href="https://www.lotier-immobilier.com/" rel="noopener noreferrer" target="_blank">www.lotier-immobilier.com</a>.</p>
      <h2>Hébergement</h2>
      <ul>
        <li><strong>Site</strong> : Hostinger International Ltd, 61 Lordou Vironos Street, 6023 Larnaca, Chypre — <a href="https://www.hostinger.fr" rel="noopener noreferrer" target="_blank">www.hostinger.fr</a>.</li>
        <li><strong>Comptes, états des lieux, photos et documents</strong> : Supabase Inc. (États-Unis) — <a href="https://supabase.com" rel="noopener noreferrer" target="_blank">supabase.com</a>. Les données sont enregistrées dans l’Union européenne, à Francfort (Allemagne).</li>
      </ul>
      <h2>Nature du service</h2>
      <p>Constatio met à disposition un outil de saisie, des modèles et des contrôles automatiques que l’utilisateur complète lui-même, sous sa responsabilité. Le service ne constitue ni une consultation juridique, ni un constat établi par un commissaire de justice. Constatio est un service partenaire de <a href="https://signabail.fr" rel="noopener noreferrer" target="_blank">Signabail</a>, édité par la même société.</p>
      <h2>Propriété intellectuelle</h2>
      <p>Le site, sa mise en page, ses textes et ses guides sont la propriété de {e.nom}. Les états des lieux, photos et documents que vous créez restent les vôtres.</p>
      <h2>Médiation de la consommation</h2>
      <p>Médiateur de la consommation : {e.mediateur}.</p>
    </PageLegale>
  );
}

export function Cgv() {
  return (
    <PageLegale titre="Conditions générales d’utilisation et de vente" chapeau={`Version en vigueur au ${MAJ}.`}>
      <h2>1. Objet</h2>
      <p>Les présentes conditions régissent l’utilisation du service Constatio et l’achat de crédits et d’abonnements auprès de {e.nom}, {e.qualite}, {e.forme} au capital de {e.capital}, {e.rcs}, {e.adresse} (TVA {e.tva}). La création d’un compte, puis chaque commande, valent acceptation de ces conditions.</p>
      <h2>2. Nature du service</h2>
      <p>Constatio permet de réaliser soi-même un <strong>état des lieux</strong> locatif (entrée, sortie, relevé d’état) depuis un téléphone : saisie pièce par pièce, photos, contrôle des mentions prévues par le décret n° 2016-382 du 30 mars 2016, document PDF et signature électronique des parties.</p>
      <p>L’utilisateur constate lui-même l’état du logement et vérifie l’exactitude de ce qu’il saisit. Les contrôles automatiques signalent les mentions manquantes ; ils ne remplacent pas sa vigilance. Le service ne constitue ni une consultation juridique, ni un constat de commissaire de justice. Un état des lieux n’a de valeur contradictoire que s’il est établi en présence des parties ou de leurs mandataires et signé par eux.</p>
      <p>L’assistant du site et les guides donnent une information générale, à jour à la date indiquée ; ils ne remplacent pas le conseil d’un professionnel du droit sur une situation particulière.</p>
      <h2>3. Compte</h2>
      <p>Le compte est personnel. L’utilisateur garde ses identifiants confidentiels et répond de l’usage fait de son compte. Il garantit être en droit de saisir les informations relatives aux autres parties (locataire, bailleur, mandataire) et les en informe.</p>
      <p>Le titulaire d’un compte professionnel peut inviter des collaborateurs, qui disposent chacun de leur propre identifiant. Il décide de leurs droits et répond de l’usage qu’ils font du compte ; les collaborateurs n’ont pas accès à la facturation. Les états des lieux réalisés par un collaborateur appartiennent au compte de l’agence.</p>
      <h2>4. Crédits</h2>
      <ul>
        <li>La saisie, les brouillons et l’aperçu sont gratuits. <strong>Un crédit</strong> est consommé à la génération du document définitif d’un état des lieux.</li>
        <li>Tant qu’aucune partie n’a signé, un état des lieux peut être rouvert, corrigé et régénéré sans nouveau crédit.</li>
        <li>Les crédits achetés à l’unité ou en pack sont valables vingt-quatre mois à compter de l’achat.</li>
        <li>Le crédit offert avec un bail Signabail est réservé à l’état des lieux d’entrée de ce bail et valable vingt-quatre mois ; il n’est ni cessible ni remboursable.</li>
      </ul>
      <h2>5. Commande, prix et paiement</h2>
      <p>Les offres et leurs prix sont présentés dans l’espace client, rubrique « Crédits et abonnement ». Les prix sont indiqués en euros, toutes taxes comprises (TVA à 20 % incluse) ; le prix applicable est celui affiché au moment de la commande.</p>
      <p>La commande se passe en trois temps : choix de l’offre, acceptation des présentes conditions, puis paiement par carte bancaire sur la page sécurisée de Stripe. {e.nom} ne reçoit ni ne conserve aucun numéro de carte. Les crédits sont ajoutés au compte dès la confirmation du paiement par Stripe, qui adresse à l’acheteur un reçu ; les factures sont disponibles depuis « Mon abonnement et mes factures ».</p>
      <h2>6. Abonnements Premium</h2>
      <p>L’abonnement est mensuel, sans engagement, et se renouvelle chaque mois par prélèvement sur la carte enregistrée. Il se résilie à tout moment, en ligne, depuis « Mon abonnement et mes factures » ; la résiliation prend effet à la fin de la période payée.</p>
      <p>Les états des lieux inclus dans un abonnement sont utilisables tant que l’abonnement est payé ; ils ne se reportent pas d’une année sur l’autre et s’éteignent à la résiliation ou en cas d’impayé.</p>
      <h2>7. Droit de rétractation</h2>
      <p>Le consommateur dispose d’un délai de quatorze jours à compter de l’achat pour se rétracter, sans motif, d’un achat de crédits ou d’un abonnement. Il lui suffit d’écrire à {ecrire}, ou d’envoyer le formulaire ci-dessous à {e.nom}, {e.adresse}. Les crédits non utilisés sont alors remboursés par le moyen de paiement utilisé, dans les quatorze jours.</p>
      <p>La génération d’un document définitif est la fourniture immédiate d’un contenu numérique : avant de la lancer, l’utilisateur la demande expressément et reconnaît qu’il perd son droit de rétractation pour le crédit ainsi utilisé (article L.221-28 du Code de la consommation).</p>
      <p className="rounded-xl border border-trait bg-surface p-3 text-sm"><strong>Formulaire de rétractation</strong><br />À l’attention de {e.nom}, {e.adresse} — {e.email}.<br />Je vous notifie par la présente ma rétractation du contrat portant sur l’achat ci-dessous : offre commandée le … ; nom et adresse e-mail du compte : … ; date : … ; signature (si le formulaire est envoyé sur papier) : …</p>
      <h2>8. Signature</h2>
      <p>Deux modes de signature sont proposés une fois le document généré ; l’un exclut l’autre pour un même état des lieux.</p>
      <p><strong>Signature à la main sur l’écran</strong>, comprise dans le crédit : les parties signent sur l’appareil de la personne qui réalise l’état des lieux, ou à distance par un lien personnel à usage unique. Il s’agit d’une signature électronique simple au sens du règlement (UE) n° 910/2014 (eIDAS). Celui qui transmet un lien de signature s’assure qu’il le remet à la bonne personne. Un dossier de preuve (date, mode de signature, adresse IP, appareil, empreinte numérique du document) est joint à l’exemplaire signé.</p>
      <p><strong>Signature électronique par DocuSeal</strong>, en option payante par état des lieux, au prix affiché avant le paiement : chaque partie reçoit un e-mail de DocuSeal et signe depuis son propre appareil. Le document signé, accompagné du certificat du prestataire, est conservé dans l’espace client. Avant l’envoi, l’utilisateur demande expressément l’exécution immédiate de la prestation et reconnaît perdre son droit de rétractation : <strong>une fois la demande envoyée aux signataires, l’option n’est pas remboursable</strong>, y compris si une partie refuse de signer. Elle reste acquise si la demande doit être renvoyée.</p>
      <h2>9. Remise des exemplaires</h2>
      <p>L’état des lieux est remis à chaque partie au moment de sa signature. L’exemplaire signé est mis à la disposition de l’utilisateur dans son espace ; il lui appartient d’en remettre un à chaque partie, sur papier ou par voie électronique. La partie qui a signé à distance retrouve en outre son exemplaire par son lien personnel pendant trente jours.</p>
      <h2>10. Présentation des documents</h2>
      <p>L’utilisateur peut faire figurer un filigrane sur les photos de ses documents et, pour un compte professionnel, son logo. Il garantit détenir les droits sur le logo qu’il dépose. Les documents portent la mention « Réalisé avec Constatio ».</p>
      <h2>11. Conservation et disponibilité</h2>
      <p>Les documents restent accessibles dans l’espace client pendant la durée de vie du compte. L’utilisateur est invité à en conserver un exemplaire. {e.nom} s’efforce d’assurer la continuité du service, sans garantir une disponibilité ininterrompue ; la saisie d’une visite reste possible hors connexion.</p>
      <h2>12. Responsabilité</h2>
      <p>{e.nom} met à jour les modèles et les contrôles en fonction de l’évolution des textes. Sa responsabilité ne saurait être engagée du fait d’informations inexactes ou incomplètes saisies par l’utilisateur, d’un état des lieux non signé par les parties, ni de l’usage d’un document en dehors de son objet. Rien dans les présentes ne limite les droits que la loi reconnaît au consommateur.</p>
      <h2>13. Données personnelles</h2>
      <p>Le traitement des données est décrit dans la <Link to="/confidentialite">politique de confidentialité</Link>.</p>
      <h2>14. Médiation et litiges</h2>
      <p>En cas de litige, le consommateur adresse d’abord une réclamation écrite à {ecrire}. À défaut de solution, il peut recourir gratuitement au médiateur de la consommation : {e.mediateur}, dans un délai d’un an à compter de sa réclamation écrite (art. L.612-2 du Code de la consommation). Droit applicable : droit français.</p>
    </PageLegale>
  );
}

export function Confidentialite() {
  return (
    <PageLegale titre="Politique de confidentialité et cookies" chapeau={`Dernière mise à jour : ${MAJ}.`}>
      <p>Cette politique décrit comment Constatio traite les données personnelles de ses utilisateurs (bailleurs, professionnels) et des personnes qui figurent dans les états des lieux (locataires, mandataires), conformément au Règlement général sur la protection des données (RGPD, règlement UE 2016/679) et à la loi « Informatique et Libertés ».</p>

      <h2>1. Responsable du traitement</h2>
      <p>{e.nom} ({e.forme}, {e.rcs}), {e.qualite}, {e.adresse} — voir les <Link to="/mentions-legales">mentions légales</Link>. Pour toute question relative aux données personnelles : {ecrire}.</p>
      <p>Lorsque vous saisissez les coordonnées d’un locataire ou d’un mandataire pour établir un état des lieux, vous le faites pour votre propre compte ; Constatio conserve ces données pour vous fournir le service.</p>

      <h2>2. Données que nous traitons</h2>
      <ul>
        <li><strong>Compte</strong> : nom, prénom, adresse e-mail, téléphone si vous l’indiquez, mot de passe (enregistré uniquement sous forme hachée). Pour une SCI ou un professionnel : dénomination, SIRET, adresse, carte professionnelle.</li>
        <li><strong>États des lieux</strong> : adresse et description du logement, identité et coordonnées des parties et de leurs mandataires, nouvelle adresse du locataire à la sortie, relevés de compteurs, clés remises, état de chaque élément, inventaire du mobilier, remarques.</li>
        <li><strong>Photos</strong> : l’image, la date et l’heure de la prise de vue et, seulement si vous l’autorisez sur votre appareil, la position géographique.</li>
        <li><strong>Signature</strong> : le tracé manuscrit, la date et l’heure, le mode de signature, l’adresse IP et le type d’appareil du signataire, l’empreinte numérique du document signé.</li>
        <li><strong>Journal de preuve</strong> : horodatage des générations de documents, des liens de signature créés et des signatures.</li>
        <li><strong>Lien avec Signabail</strong>, si vous l’utilisez : l’identifiant de votre compte Signabail, votre adresse e-mail et les informations du bail utiles à l’état des lieux (adresse, parties, type de bail, pièces).</li>
        <li><strong>Crédits et abonnements</strong> : historique des crédits reçus et consommés, identifiant client chez Stripe. Le paiement est traité par Stripe : Constatio ne reçoit ni ne conserve aucun numéro de carte.</li>
        <li><strong>Présentation</strong> : le logo et le texte de filigrane que vous choisissez.</li>
      </ul>
      <p>Constatio n’utilise aucun outil publicitaire, aucun traceur tiers et aucun outil de mesure d’audience. Les questions posées à l’assistant du site sont traitées sur votre appareil : elles ne sont ni envoyées ni enregistrées.</p>

      <h2>3. Finalités et bases légales</h2>
      <ul>
        <li><strong>Réalisation, génération, signature et conservation des états des lieux</strong> : exécution du contrat conclu avec l’utilisateur.</li>
        <li><strong>Dossier de preuve des signatures et journal</strong> : intérêt légitime à établir la date, l’auteur et l’intégrité des documents.</li>
        <li><strong>Crédits, facturation et comptabilité</strong> : exécution du contrat et obligation légale.</li>
        <li><strong>E-mails de service</strong> (confirmation d’inscription, mot de passe oublié) : exécution du contrat. Aucun e-mail commercial n’est envoyé sans votre accord.</li>
        <li><strong>Administration et assistance</strong> : intérêt légitime à assurer le fonctionnement et la sécurité du service ; chaque intervention d’un administrateur est journalisée.</li>
      </ul>

      <h2>4. Destinataires</h2>
      <p>Vos données ne sont accessibles qu’aux membres de votre compte et, dans la limite de leurs fonctions, aux personnes habilitées de {e.nom}. Une partie invitée à signer à distance ne voit que le document qu’elle doit signer. Les données sont confiées aux seuls prestataires nécessaires au service :</p>
      <ul>
        <li><strong>Supabase</strong> : base de données, comptes et fichiers (photos, documents), dans l’Union européenne ;</li>
        <li><strong>Hostinger</strong> : hébergement du site ;</li>
        <li><strong>Stripe</strong> : paiement en ligne, reçus et factures ;</li>
        <li><strong>DocuSeal</strong> : signature électronique, uniquement si vous choisissez cette option — nom, adresse e-mail des signataires et document à signer lui sont alors transmis.</li>
      </ul>
      <p>Nous ne vendons ni ne louons vos données à des tiers.</p>

      <h2>5. Hébergement et transferts hors de l’Union européenne</h2>
      <p>Les comptes, états des lieux, photos et documents sont enregistrés à Francfort (Allemagne). Supabase étant une société américaine, et Stripe pouvant traiter certaines données hors de l’Union européenne, ces relations sont encadrées par les garanties prévues par le RGPD (décision d’adéquation ou clauses contractuelles types de la Commission européenne).</p>

      <h2>6. Durées de conservation</h2>
      <ul>
        <li><strong>États des lieux, photos, signatures et journal de preuve</strong> : pendant la durée de vie du compte et, pour un état des lieux signé, pendant la durée du bail augmentée du délai de prescription applicable, sauf demande d’effacement compatible avec nos obligations légales.</li>
        <li><strong>Brouillons</strong> : jusqu’à leur suppression par l’utilisateur.</li>
        <li><strong>Liens de signature</strong> : valables sept jours pour signer, puis trente jours pour retrouver son exemplaire ; seule une empreinte du lien est conservée.</li>
        <li><strong>Données de facturation</strong> : dix ans (art. L.123-22 du Code de commerce).</li>
        <li><strong>Compte</strong> : jusqu’à sa fermeture, puis archivage des seules données soumises à une obligation légale.</li>
      </ul>

      <h2>7. Sécurité</h2>
      <p>Connexions chiffrées (HTTPS), mots de passe hachés, cloisonnement strict des données par compte appliqué par la base de données elle-même, liens de signature personnels à usage unique, documents signés figés, empreinte numérique permettant de détecter toute modification d’un document.</p>

      <h2>8. Vos droits</h2>
      <p>Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité de vos données. Pour les exercer, écrivez à {ecrire}. Nous répondons dans un délai d’un mois.</p>
      <p>Si vous êtes locataire ou partie à un état des lieux, vous pouvez aussi vous adresser à la personne qui l’a établi. Un état des lieux signé étant une pièce contractuelle commune aux parties, son effacement peut être limité tant qu’il est nécessaire à la preuve.</p>
      <p>Vous pouvez introduire une réclamation auprès de la <strong>CNIL</strong> : <a href="https://www.cnil.fr" rel="noopener noreferrer" target="_blank">www.cnil.fr</a>.</p>

      <h2>9. Fermeture du compte</h2>
      <p>Vous pouvez demander la fermeture de votre compte et la suppression de vos données personnelles, hors données que la loi nous oblige à conserver, en écrivant à {ecrire}.</p>

      <h2 id="cookies">10. Cookies et stockage sur votre appareil</h2>
      <p>Constatio ne dépose <strong>aucun cookie publicitaire ni de mesure d’audience</strong> ; c’est pourquoi aucun bandeau de consentement ne vous est présenté. Seul un stockage strictement nécessaire au service est utilisé sur votre appareil :</p>
      <ul>
        <li>votre <strong>session de connexion</strong>, pour vous éviter de vous identifier à chaque page ;</li>
        <li>une <strong>copie de vos états des lieux et de vos photos</strong>, pour travailler sans réseau pendant la visite ; elle est envoyée au serveur dès que la connexion revient ;</li>
        <li>les fichiers de l’application, pour qu’elle s’ouvre hors connexion.</li>
      </ul>
      <p>Ce stockage est effacé à la déconnexion, ou en vidant les données du site dans votre navigateur. Sur un appareil partagé, déconnectez-vous après usage.</p>

      <h2>11. Modifications</h2>
      <p>Cette politique peut être mise à jour ; la date de la dernière mise à jour figure en haut de page.</p>
    </PageLegale>
  );
}
