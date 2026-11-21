# Consignes de rédaction des guides Constatio

Lecteur : un bailleur particulier, une SCI ou un gestionnaire, en France, qui cherche une réponse précise. Ton : direct, rassurant, vouvoiement, phrases courtes, aucun superlatif, aucun jargon non expliqué. Pas de tiret cadratin en incise, pas de « il est important de noter », pas de formule creuse.

## Format du fichier (obligatoire, exact)

Un fichier Markdown par article, nommé `<slug>.md`, commençant par cet en-tête :

```
---
titre: "…"            # 50 à 65 caractères, la question que se pose le lecteur
description: "…"      # 140 à 155 caractères, pour les moteurs de recherche
date: AAAA-MM-JJ      # date de publication fournie, ne pas la changer
categorie: "…"        # une parmi : Obligations, Dépôt de garantie, Cas particuliers, Sur place
resume: "…"           # 2 à 3 phrases qui répondent tout de suite à la question (c'est ce que citera un assistant IA)
points_cles:          # 3 à 5 faits vérifiables, une ligne chacun, avec le chiffre ou le délai
  - "…"
questions:            # 3 à 5 questions réelles de lecteurs, réponse de 1 à 3 phrases
  - q: "…"
    r: "…"
sources:              # les textes cités dans l'article, tels quels
  - "Loi n° 89-462 du 6 juillet 1989, article 3-2"
---
```

Puis le corps : 600 à 900 mots, titres `##` formulés comme des questions ou des actions, paragraphes de 2 à 4 phrases, une liste ou un tableau quand il y a une vraie énumération, un exemple chiffré quand il y a un calcul. Pas de titre `#` (le titre vient de l'en-tête). Terminer par une section `## En pratique` : 3 à 5 gestes concrets. Aucun lien externe. Liens internes possibles vers d'autres guides sous la forme `[texte](/guides/<slug>)`, uniquement vers les slugs de la liste ci-dessous.

## Règle absolue : le droit

N'affirmer QUE ce qui figure dans la fiche ci-dessous. Si un point n'y est pas, ne pas l'inventer : l'omettre, ou écrire que cela dépend du bail ou relève d'un professionnel. Ne citer aucune jurisprudence, aucun numéro d'arrêt, aucun montant ou délai absent de la fiche. Chaque règle citée est suivie de sa référence entre parenthèses.

### Fiche de droit (France, location à usage de résidence principale)

**État des lieux — loi n° 89-462 du 6 juillet 1989, article 3-2**
- Établi à l'entrée et à la sortie, contradictoirement et amiablement, par les parties ou par un tiers qu'elles mandatent ; en autant d'exemplaires que de parties ; joint au bail.
- S'il ne peut pas être établi ainsi, il l'est par un commissaire de justice, à l'initiative de la partie la plus diligente, à frais partagés par moitié entre bailleur et locataire, à un tarif fixé par décret ; les parties sont convoquées par lettre recommandée avec accusé de réception au moins sept jours à l'avance.
- À défaut d'état des lieux, la présomption de l'article 1731 du Code civil (le locataire est présumé avoir reçu le logement en bon état de réparations locatives) ne peut pas être invoquée par la partie qui a fait obstacle à son établissement ou à sa remise.
- Le locataire peut demander au bailleur de compléter l'état des lieux d'entrée dans les dix jours qui suivent son établissement ; en cas de refus, il peut saisir la commission départementale de conciliation.
- Pendant le premier mois de la période de chauffe, le locataire peut demander que l'état des lieux soit complété par l'état des éléments de chauffage.
- Le bailleur ou son mandataire complète l'état des lieux par les relevés des index pour chaque énergie, quand le logement a un chauffage ou une eau chaude individuels, ou collectifs avec comptage individuel.

**Contenu — décret n° 2016-382 du 30 mars 2016**
- Mentions (art. 2) : type d'état des lieux (entrée ou sortie) ; date ; localisation du logement ; nom ou dénomination des parties et domicile ou siège du bailleur ; le cas échéant nom et domicile ou siège des mandataires ; le cas échéant relevés des compteurs individuels d'eau ou d'énergie ; détail et destination des clés ou de tout autre moyen d'accès ; pour chaque pièce et partie du logement, description précise de l'état des revêtements des sols, murs et plafonds, des équipements et des éléments, qui peut être complétée d'observations ou de réserves et illustrée d'images ; signature des parties ou de leurs mandataires.
- Sortie, en plus : adresse du nouveau domicile ou du lieu d'hébergement du locataire ; date de l'état des lieux d'entrée ; éventuellement les évolutions de l'état de chaque pièce constatées depuis l'entrée.
- Forme : sur papier ou sous forme électronique ; remis en main propre ou par voie dématérialisée à chaque partie ou à son mandataire au moment de la signature. Entrée et sortie doivent pouvoir se comparer (même présentation ou document unique).
- Vétusté (art. 4) : « l'état d'usure ou de détérioration résultant du temps ou de l'usage normal des matériaux et éléments d'équipement ». Les parties peuvent convenir, dès la signature du bail, d'appliquer une grille de vétusté choisie parmi celles ayant fait l'objet d'un accord collectif de location, même si le logement n'en relève pas.

**Obligations du locataire — loi de 1989, article 7**
- Il répond des dégradations et pertes survenues pendant la location, sauf s'il prouve la force majeure, la faute du bailleur ou le fait d'un tiers qu'il n'a pas introduit dans le logement (art. 7 c).
- Il prend en charge l'entretien courant et les réparations locatives, sauf si elles sont dues à la vétusté, une malfaçon, un vice de construction, un cas fortuit ou la force majeure (art. 7 d). La liste des réparations locatives est fixée par le décret n° 87-712 du 26 août 1987.

**Dépôt de garantie — loi de 1989, article 22**
- Plafond : un mois de loyer hors charges en location vide ; deux mois en meublé (art. 25-6) ; aucun dépôt en bail mobilité.
- Restitution : dans un délai maximal de deux mois à compter de la remise des clés ; un mois si l'état des lieux de sortie est conforme à l'état des lieux d'entrée.
- Le bailleur déduit les sommes restant dues et celles dont le locataire pourrait être tenu, à condition qu'elles soient dûment justifiées.
- Retard : le dépôt restant dû est majoré de 10 % du loyer mensuel en principal pour chaque période mensuelle commencée en retard. La majoration n'est pas due si le retard vient de ce que le locataire n'a pas transmis sa nouvelle adresse.
- Immeuble collectif : le bailleur peut conserver une provision d'au plus 20 % du dépôt jusqu'à l'arrêté annuel des comptes de l'immeuble ; la régularisation intervient dans le mois qui suit l'approbation définitive des comptes.

**Meublé — décret n° 2015-981 du 31 juillet 2015 ; loi de 1989, article 25-5**
- Onze équipements au minimum : literie comprenant couette ou couverture ; dispositif d'occultation des fenêtres dans les pièces destinées à être utilisées comme chambre à coucher ; plaques de cuisson ; four ou four à micro-ondes ; réfrigérateur et congélateur ou, au minimum, réfrigérateur doté d'un compartiment à une température inférieure ou égale à −6 °C ; vaisselle nécessaire à la prise des repas ; ustensiles de cuisine ; table et sièges ; étagères de rangement ; luminaires ; matériel d'entretien ménager adapté aux caractéristiques du logement.
- Un inventaire et un état détaillé du mobilier sont établis dans les mêmes formes que l'état des lieux, à l'entrée et à la sortie ; ils ne donnent lieu à aucune facturation autre que celle liée à l'état des lieux.

**Honoraires — loi de 1989, article 5 ; décret n° 2014-890 du 1er août 2014**
- État des lieux d'entrée réalisé par un professionnel mandaté : la part facturée au locataire ne dépasse ni celle du bailleur, ni un plafond de 3 € par mètre carré de surface habitable.
- État des lieux de sortie : aucun honoraire ne peut être facturé au locataire (hors intervention d'un commissaire de justice dans le cas prévu à l'article 3-2).

**Divers**
- Les actions nées du bail se prescrivent par trois ans (loi de 1989, art. 7-1).
- L'écrit électronique a la même force probante que l'écrit papier, à condition que son auteur puisse être identifié et que son intégrité soit garantie (Code civil, art. 1366 et 1367 ; règlement européen eIDAS n° 910/2014).

## Mention de Constatio

Une seule, dans `## En pratique` ou juste avant, en une ou deux phrases sobres. Ce que l'on peut dire : Constatio est un service d'état des lieux sur téléphone, pièce par pièce, qui vérifie les mentions obligatoires avant de générer le document, fonctionne sans réseau, et compare l'entrée et la sortie. Le brouillon est gratuit. Ne rien dire d'autre du produit (ni prix, ni signature, ni PDF, ni IA).

## Slugs existants (pour les liens internes)

etat-des-lieux-mentions-obligatoires, etat-des-lieux-entree-comment-faire, etat-des-lieux-sortie-deroulement, qui-peut-faire-etat-des-lieux, etat-des-lieux-electronique-valeur-juridique, restitution-depot-de-garantie-delais, retenues-depot-de-garantie-justificatifs, grille-de-vetuste-location, degradations-ou-usure-normale, retard-restitution-depot-de-garantie-penalite, inventaire-mobilier-location-meublee, completer-etat-des-lieux-dix-jours, locataire-refuse-signer-etat-des-lieux, absence-etat-des-lieux-consequences, pre-etat-des-lieux-visite-conseil, releve-compteurs-etat-des-lieux, cles-etat-des-lieux-remise, photos-etat-des-lieux-preuve, honoraires-etat-des-lieux-plafond, etat-des-lieux-maison-jardin-exterieurs
