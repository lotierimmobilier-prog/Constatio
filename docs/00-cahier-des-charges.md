# PROMPT — Service partenaire d'états des lieux, lié à Signabail

> À coller dans Claude Code (ou Lovable/Bolt). Les éléments entre [crochets] sont à compléter ou à valider avant de lancer.

---

## 1. Contexte

Tu es un développeur full-stack senior et un expert de la location immobilière en France. Tu vas concevoir et développer un nouveau site SaaS payant de réalisation d'états des lieux (EDL), nommé **Constatio**, accessible sur https://constatio.fr.

Ce service est un **partenaire indépendant mais lié** de **Signabail** (https://signabail.fr), le site de rédaction et de signature de baux conçu par LOTIER (SARL LOTIER, agence immobilière titulaire de la carte professionnelle, 40 rue Française, 34500 Béziers).

Rappel de l'offre Signabail, dont le nouveau service doit reprendre la logique commerciale et le niveau de qualité :
- baux d'habitation à 19,90 € l'unité, baux commerciaux/professionnels à 89 €, avenants, actes de caution, courriers à 9,90 €, quittance gratuite ;
- packs de 5 crédits (75 €) et 10 crédits (139 €) valables 24 mois, brouillon gratuit, crédit consommé à la génération définitive ;
- Premium Investisseur 14,90 €/mois (12 crédits/an, 5 entités bailleresses) et Premium Pro 49,90 €/mois (40 crédits/an, 3 utilisateurs, marque blanche) ;
- questionnaire question par question avec explication pédagogique de chaque mention, contrôles juridiques en direct, aperçu, signature électronique depuis le téléphone avec dossier de preuve horodaté, archivage ;
- relecture par un avocat partenaire en option ;
- ton direct, rassurant, vouvoiement ;
- Signabail affiche aujourd'hui un « état des lieux offert avec chaque bail d'habitation » (entrée et sortie, pièce par pièce, pré-rempli depuis le bail).

## 2. Ce que doit être le nouveau service

Un outil complet d'état des lieux numérique, utilisable seul (sans bail Signabail) par des particuliers, SCI, investisseurs, agences et gestionnaires, sur téléphone ou tablette, directement dans le logement.

### Indépendance
- marque, nom de domaine, charte, CGV, mentions légales et tunnel de paiement Stripe propres ;
- un utilisateur peut créer un compte et faire un EDL sans jamais passer par Signabail ;
- base de données et déploiement séparés.

### Lien avec Signabail
- bouton « Se connecter avec Signabail » (SSO / OAuth entre les deux projets Supabase) pour ne pas recréer de compte ;
- import d'un bail Signabail en un clic : bailleur, locataires, adresse, type de bail (vide / meublé / mobilité / étudiant / colocation / garage), surface, date d'entrée, dépôt de garantie, liste des pièces — l'EDL d'entrée est pré-rempli ;
- remplacer la mention « EDL offert » de Signabail par : « 1 état des lieux d'entrée offert sur Constatio avec chaque bail d'habitation » (crédit automatiquement versé sur le compte partenaire) — l'offre gratuite côté Signabail reste un EDL simple, le service partenaire apporte la version complète ;
- bannière croisée dans les deux sites (« Votre bail est signé ? Faites l'état des lieux » / « Pas encore de bail ? Rédigez-le sur Signabail ») ;
- offre groupée « Bail + EDL entrée + EDL sortie » à prix réduit, vendable depuis l'un ou l'autre site ;
- abonnements Premium cumulables avec remise si l'utilisateur a les deux ;
- mention « Service partenaire de Signabail — conçu par LOTIER » en pied de page.

## 3. Reprendre les options EDL de Collab (Locadys)

Le module « États des lieux » de Collab (collab.lotier-immobilier.com, menu Biens & contrats → États des lieux) est la référence fonctionnelle. Le nouveau service doit en reprendre toutes les options et rester compatible avec son modèle de données, pour que LOTIER puisse importer dans Collab les EDL réalisés sur le site (et inversement) :

- types d'EDL : **entrant**, **sortant**, **relevé d'état** (visite intermédiaire) ;
- en-tête : lot, locataire(s), bailleur, type, date, agent / personne qui réalise l'EDL ;
- **état des pièces** : ajout de chaque pièce, état par élément, observations ;
- **photos** par pièce et par élément ;
- **relevés de compteurs** : électricité (kWh, HP/HC si double tarif), gaz (m³), eau froide et eau chaude (m³), avec photo du compteur et numéro de compteur ;
- **remise des clés** : nombre et nature (clés, badges, bips, télécommandes, cartes) ;
- **remarques générales** sur le logement ;
- cycle de statut : **brouillon → terminé → signé** ;
- rattachement au locataire et dépôt dans son espace client ;
- **comparaison entrée / sortie** qui justifie les retenues sur le dépôt de garantie (sans EDL d'entrée, aucune dégradation n'est opposable — le rappeler dans l'interface) ;
- compatibilité avec l'application historique Lotier-EDL (lotier-edl.com) pour la reprise des anciens EDL ;
- module **jardins et extérieurs** (déjà conçu pour le logiciel d'EDL de LOTIER) : pelouse, arbres, haies et arbustes, massifs, potager, palmiers/bambous/invasives, arrosage automatique, clôtures/murs/portails, terrasses/dallages/allées, abris et dépendances, piscine/spa, éclairage extérieur, récupération d'eau/compost, propreté générale, observations libres.

Prévoir un **export JSON documenté + une API** (clé par compte Pro) au format des tables Collab, et un export PDF.

## 4. Conformité juridique (à intégrer dans le parcours, pas en annexe)

- article 3-2 de la loi n° 89-462 du 6 juillet 1989 et **décret n° 2016-382 du 30 mars 2016** (contenu obligatoire de l'EDL) : type d'EDL, date, adresse, identité des parties et des mandataires, relevés, détail et destination des clés, description pièce par pièce des revêtements, équipements et éléments, signatures ; pour l'EDL de sortie, adresse du nouveau domicile du locataire et date de l'EDL d'entrée ;
- **inventaire du mobilier** obligatoire pour les meublés (décret n° 2015-981 : liste minimale des équipements — le vérifier automatiquement et alerter s'il manque un élément) ;
- possibilité de joindre une **grille de vétusté** (choix entre une grille par défaut et une grille personnalisée) et calcul de la vétusté dans la comparaison de sortie ;
- **complément d'EDL** : le locataire peut demander à compléter l'EDL d'entrée dans les 10 jours, et pour le chauffage pendant le premier mois de la période de chauffe — prévoir le formulaire, les rappels automatiques et le verrouillage passé le délai ;
- dépôt de garantie : restitution sous 1 mois si l'EDL de sortie est conforme, 2 mois sinon ; générer le décompte de restitution (retenues justifiées par devis/factures, vétusté déduite) et le courrier au locataire ;
- honoraires d'EDL facturés par un professionnel au locataire plafonnés (3 €/m² — [à vérifier dans le décret n° 2014-890 au moment du développement]) : appliquer le plafond automatiquement sur les prestations réalisées par un agent ;
- EDL contradictoire : présence des deux parties ou de leurs mandataires ; prévoir la procuration du mandataire ;
- signature électronique conforme eIDAS sur place (sur l'écran de la tablette) ou à distance, dossier de preuve horodaté, empreinte du PDF, photos horodatées et géolocalisées non modifiables après signature ;
- RGPD : hébergement en France, durée de conservation, purge, droit d'accès ;
- renvoi vers un commissaire de justice si une partie refuse l'EDL (information + mise en relation).

Contrôles en direct comme sur Signabail : chaque alerte (compteur non relevé, pièce sans état, meublé incomplet, clé non décrite, signature manquante) renvoie à l'étape concernée.

## 5. Parcours utilisateur

1. **Profil** : particulier, SCI, professionnel (agence, gestionnaire, conciergerie).
2. **Point de départ** : nouveau logement / import d'un bail Signabail / import d'un EDL précédent (l'EDL d'entrée devient la base de la sortie).
3. **Description du logement** : type, surface, pièces (modèles T1 à T6, maison, studio, garage, local), meublé ou non, extérieurs.
4. **Visite pièce par pièce** sur mobile : grille rapide (neuf / bon état / état d'usage / mauvais état / hors service) par élément (sols, murs, plafonds, menuiseries, électricité, plomberie, chauffage, équipements), photos, observations.
5. **Dictée vocale** des observations, transcrite puis structurée par IA par pièce et par élément (l'utilisateur relit et corrige) ; signalement des passages douteux de la dictée.
6. **Compteurs, clés, remarques générales**.
7. **Aperçu**, puis génération du document définitif (consomme un crédit — brouillon gratuit).
8. **Signature** des parties, envoi par e-mail du PDF à chacun, archivage.
9. **Sortie** : comparaison automatique côte à côte avec l'entrée (photos avant/après), écarts surlignés, chiffrage des retenues avec vétusté, décompte de restitution du dépôt de garantie, courrier au locataire.

Exigences techniques du parcours : **PWA installable avec mode hors connexion** (caves, sous-sols, zones sans réseau) et synchronisation au retour du réseau ; compression des photos ; reprise d'un EDL interrompu ; grands boutons utilisables d'une main.

## 6. Offre et tarifs [à valider par Jérôme — proposition alignée sur Signabail]

- **EDL numérique en autonomie** : à l'unité [14,90 €] ; **pack entrée + sortie** [24,90 €] ; packs de 5 et 10 crédits valables 24 mois ;
- **1 EDL d'entrée offert** avec chaque bail d'habitation Signabail ;
- **offre groupée Bail Signabail + EDL entrée + sortie** [34,90 €] ;
- **Premium Investisseur** [9,90 €/mois] : EDL illimités ou quota annuel, relevés d'état illimités, historique par logement, export Word/PDF ;
- **Premium Pro** [39,90 €/mois] : multi-utilisateurs, marque blanche (logo, en-tête, pied de page), API/export Collab, gestion des agents ;
- **Prestation sur place réalisée par un agent** (option « Je ne peux pas me déplacer ») : réservation en ligne d'un créneau, réalisée par LOTIER sur sa zone (Béziers, Montpellier, Nîmes, Avignon, Narbonne, Carcassonne, Capendu/Trèbes), puis par un réseau d'agents partenaires ; tarif au m² dans la limite du plafond légal pour la part locataire ; paiement Stripe à la réservation ;
- sans Premium, les documents portent « Réalisé avec Constatio — partenaire Signabail ».

## 7. Stack technique

- Front : React + Vite + TypeScript + Tailwind (compatible Lovable/Bolt), PWA ;
- Données et authentification : Supabase (projet dédié, hébergement UE), stockage des photos dans Supabase Storage avec règles d'accès strictes (RLS) ;
- Paiement : Stripe (unité, packs, abonnements, coupons, crédits offerts via webhook Signabail) ;
- Signature électronique : DocuSeal (déjà utilisé par Collab) ou équivalent conforme eIDAS ;
- PDF : vrais PDF générés côté serveur (pas de page HTML à imprimer), mise en page professionnelle avec photos en vignettes et annexe photos ;
- E-mails transactionnels : via le domaine du service (SPF/DKIM/DMARC) ;
- Hébergement : OVH (déploiement via GitHub webhook) ;
- IA : transcription de la dictée + structuration des observations par pièce (API Anthropic) ;
- Webhooks entre Signabail et le nouveau service : « bail signé » → création d'un EDL pré-rempli + crédit offert ; « EDL signé » → rattachement au bail côté Signabail.

## 8. Site vitrine et SEO

- page d'accueil avec la promesse (« Un état des lieux incontestable en 20 minutes, depuis votre téléphone »), démonstration animée du parcours, tarifs, FAQ juridique, page « Partenaire Signabail », page « Faire réaliser mon EDL par un agent » ;
- articles SEO : obligations de l'EDL, EDL de sortie et dépôt de garantie, inventaire du mobilier d'un meublé, grille de vétusté, qui peut faire un état des lieux ;
- ton identique à Signabail : direct, rassurant, vouvoiement, risques juridiques expliqués simplement.

## 9. Livrables attendus, dans cet ordre

1. Arborescence du site et maquettes des écrans clés (mobile d'abord).
2. Schéma de base de données Supabase commenté, aligné sur le module EDL de Collab (tables, relations, RLS).
3. Spécification des échanges Signabail ↔ Constatio (SSO, webhooks, crédits offerts, offre groupée).
4. Développement par étapes : authentification et comptes → création de l'EDL et visite pièce par pièce → photos et hors connexion → PDF → signature → paiement Stripe → comparaison de sortie et dépôt de garantie → export Collab/API → site vitrine.
5. Jeux de données de test préfixés « ZZREC » et un coupe-circuit « mode test » qui bloque tout envoi réel d'e-mail, de signature et de paiement.
6. CGV, mentions légales et politique de confidentialité en brouillon, à faire relire par un avocat.

Pose-moi d'abord les questions indispensables (tarifs, périmètre de la prestation sur place) puis avance étape par étape en me montrant le résultat de chacune avant de passer à la suivante.
