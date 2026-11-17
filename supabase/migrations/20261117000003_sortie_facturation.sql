-- =============================================================================
-- Constatio — 3/5 : sortie (vétusté, retenues, décompte) et facturation
-- =============================================================================

-- Grilles de vétusté ---------------------------------------------------------
-- organisation_id null = grille par défaut de Constatio, lisible par tous.
create table public.grilles_vetuste (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete cascade,
  nom             text not null,
  created_at      timestamptz not null default now()
);

create table public.grille_vetuste_lignes (
  id              uuid primary key default gen_random_uuid(),
  grille_id       uuid not null references public.grilles_vetuste (id) on delete cascade,
  categorie       text not null,                 -- famille d'ouvrage (sol, murs, plomberie…)
  libelle         text not null,
  duree_vie_ans   smallint not null check (duree_vie_ans > 0),
  franchise_ans   smallint not null default 0 check (franchise_ans >= 0),
  -- Part qui reste à la charge du locataire quelle que soit l'ancienneté.
  part_residuelle_pct smallint not null default 0 check (part_residuelle_pct between 0 and 100),
  ordre           smallint not null default 0
);
create index grille_vetuste_lignes_grille_idx on public.grille_vetuste_lignes (grille_id);

alter table public.edl
  add constraint edl_grille_vetuste_fk foreign key (grille_vetuste_id)
  references public.grilles_vetuste (id) on delete set null;

-- Grille par défaut. Durées usuelles des accords collectifs de location :
-- valeurs PROVISOIRES, à faire valider avant la mise en ligne.
with g as (
  insert into public.grilles_vetuste (id, organisation_id, nom)
  values ('00000000-0000-4000-8000-000000000001', null, 'Grille Constatio par défaut')
  returning id
)
insert into public.grille_vetuste_lignes (grille_id, categorie, libelle, duree_vie_ans, franchise_ans, part_residuelle_pct, ordre)
select g.id, v.* from g, (values
  ('murs',        'Peintures et papiers peints',      7, 0, 10, 1),
  ('sol',         'Moquette',                         7, 0, 10, 2),
  ('sol',         'Sol PVC, linoléum',               10, 0, 10, 3),
  ('sol',         'Parquet, stratifié',              15, 0, 15, 4),
  ('sol',         'Carrelage, faïence',              25, 5, 20, 5),
  ('menuiseries', 'Portes, fenêtres, volets',        20, 5, 20, 6),
  ('plomberie',   'Robinetterie',                    10, 0, 10, 7),
  ('plomberie',   'Appareils sanitaires',            20, 5, 20, 8),
  ('electricite', 'Appareillage électrique',         15, 0, 10, 9),
  ('chauffage',   'Chaudière, radiateurs',           15, 0, 15, 10),
  ('equipements', 'Électroménager',                   8, 0, 10, 11),
  ('equipements', 'Mobilier',                        10, 0, 10, 12)
) as v;

-- Retenues sur le dépôt de garantie (EDL de sortie) ----------------------------
create table public.retenues (
  id                 uuid primary key default gen_random_uuid(),
  edl_id             uuid not null references public.edl (id) on delete cascade,
  element_id         uuid references public.edl_elements (id) on delete set null,
  libelle            text not null,
  -- Toute retenue doit être justifiée : devis, facture ou autre pièce.
  montant_devis_cents integer not null check (montant_devis_cents >= 0),
  justificatif_path  text,
  ligne_grille_id    uuid references public.grille_vetuste_lignes (id) on delete set null,
  age_ans            numeric(4, 1) check (age_ans >= 0),
  vetuste_pct        numeric(5, 2) not null default 0 check (vetuste_pct between 0 and 100),
  montant_retenu_cents integer not null check (montant_retenu_cents >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (montant_retenu_cents <= montant_devis_cents)
);
create index retenues_edl_idx on public.retenues (edl_id);
create trigger retenues_touch before update on public.retenues
  for each row execute function private.touch_updated_at();

-- Décompte de restitution (1 par EDL de sortie) --------------------------------
-- Délai légal : 1 mois si la sortie est conforme à l'entrée, 2 mois sinon,
-- à compter de la remise des clés (loi du 6 juillet 1989, art. 22).
create table public.decomptes (
  edl_id               uuid primary key references public.edl (id) on delete cascade,
  depot_cents          integer not null check (depot_cents >= 0),
  total_retenues_cents integer not null default 0 check (total_retenues_cents >= 0),
  autres_sommes_cents  integer not null default 0,   -- loyers ou charges restant dus
  autres_sommes_motif  text,
  a_restituer_cents    integer generated always as
                       (greatest(depot_cents - total_retenues_cents - autres_sommes_cents, 0)) stored,
  conforme             boolean not null,
  date_remise_cles     date not null,
  date_limite          date generated always as
                       ((date_remise_cles + case when conforme then interval '1 month' else interval '2 months' end)::date) stored,
  courrier_path        text,
  envoye_le            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger decomptes_touch before update on public.decomptes
  for each row execute function private.touch_updated_at();

-- =============================================================================
-- Facturation
-- =============================================================================

-- Tarifs : modifiables sans redéploiement. Le navigateur ne décide jamais d'un prix.
create table public.tarifs (
  code            text primary key,
  libelle         text not null,
  montant_cents   integer not null check (montant_cents >= 0),
  periodicite     text not null default 'unique' check (periodicite in ('unique', 'mensuel')),
  credits         smallint not null default 0,   -- crédits versés (par an pour un abonnement)
  validite_mois   smallint not null default 24,
  stripe_price_id text,
  actif           boolean not null default true
);
insert into public.tarifs (code, libelle, montant_cents, periodicite, credits, validite_mois) values
  ('edl_unite',            'État des lieux à l''unité',                 1490, 'unique',  1, 24),
  ('pack_entree_sortie',   'Pack entrée + sortie',                      2490, 'unique',  2, 24),
  ('pack_5',               'Pack 5 crédits',                            5900, 'unique',  5, 24),
  ('pack_10',              'Pack 10 crédits',                           9900, 'unique', 10, 24),
  ('offre_groupee',        'Bail Signabail + EDL entrée + EDL sortie',  3490, 'unique',  2, 24),
  ('premium_investisseur', 'Premium Investisseur',                       990, 'mensuel', 12, 12),
  -- Quota annuel du Premium Pro : 40 par analogie avec Signabail, à confirmer.
  ('premium_pro',          'Premium Pro',                               3990, 'mensuel', 40, 12),
  ('prestation_sur_place', 'État des lieux réalisé par un agent LOTIER', 18000, 'unique', 0, 24);

-- Crédits : un lot par achat, par cadeau Signabail ou par année d'abonnement.
create table public.credit_lots (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  origine         text not null check (origine in ('achat', 'abonnement', 'signabail', 'geste_commercial')),
  tarif_code      text references public.tarifs (code),
  quantite        smallint not null check (quantite > 0),
  restant         smallint not null check (restant >= 0),
  -- Crédit offert avec un bail Signabail : valable pour un EDL d'entrée seulement.
  type_reserve    public.edl_type,
  expire_le       timestamptz not null,
  -- Référence externe (paiement Stripe, bail Signabail) : empêche de créditer deux fois.
  reference       text unique,
  created_at      timestamptz not null default now(),
  check (restant <= quantite)
);
create index credit_lots_org_idx on public.credit_lots (organisation_id, expire_le);

create table public.credit_consommations (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references public.credit_lots (id) on delete restrict,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  edl_id          uuid unique references public.edl (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table public.abonnements (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete cascade,
  tarif_code             text not null references public.tarifs (code),
  statut                 text not null check (statut in ('actif', 'impaye', 'resilie')),
  stripe_subscription_id text unique,
  periode_debut          timestamptz not null,
  periode_fin            timestamptz not null,
  -- Remise appliquée parce que le client a aussi un Premium Signabail.
  remise_signabail       boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index abonnements_org_idx on public.abonnements (organisation_id);

create function private.a_premium(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.abonnements a
    where a.organisation_id = p_org and a.statut = 'actif' and a.periode_fin > now()
  )
$$;

-- Prestation sur place par un agent LOTIER (forfait) ----------------------------
-- Répartition des honoraires d'un EDL d'entrée (loi de 1989, art. 5 ; décret
-- n° 2014-890) : la part du locataire ne dépasse ni le plafond au m², ni la
-- part du bailleur. Un EDL de sortie n'est jamais facturé au locataire.
create table public.reservations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  edl_id            uuid references public.edl (id) on delete set null,
  type              public.edl_type not null,
  secteur           text not null check (secteur in ('beziers', 'montpellier', 'nimes', 'avignon',
                                                     'narbonne', 'carcassonne', 'capendu_trebes')),
  adresse           text not null,
  code_postal       text not null,
  ville             text not null,
  surface_m2        numeric(7, 2) not null check (surface_m2 > 0),
  creneau           timestamptz not null,
  contact_nom       text not null,
  contact_telephone text not null,
  montant_cents     integer not null,
  plafond_m2_cents  integer not null default 300,   -- plafond en vigueur à la réservation
  part_locataire_cents integer not null default 0 check (part_locataire_cents >= 0),
  part_bailleur_cents  integer generated always as (montant_cents - part_locataire_cents) stored,
  statut            text not null default 'en_attente_paiement'
                    check (statut in ('en_attente_paiement', 'payee', 'planifiee', 'realisee', 'annulee', 'remboursee')),
  agent_id          uuid references auth.users (id) on delete set null,
  stripe_payment_intent_id text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (part_locataire_cents * 2 <= montant_cents),
  check (part_locataire_cents <= plafond_m2_cents * surface_m2),
  check (type = 'entrant' or part_locataire_cents = 0)
);
create index reservations_org_idx on public.reservations (organisation_id);
create trigger reservations_touch before update on public.reservations
  for each row execute function private.touch_updated_at();

-- Clés d'API (Premium Pro). Seule l'empreinte de la clé est conservée.
create table public.api_cles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  nom              text not null,
  prefixe          text not null,                -- « cst_ab12 », affiché pour reconnaître la clé
  cle_hash         text not null unique,
  cree_par         uuid references auth.users (id) on delete set null,
  derniere_utilisation timestamptz,
  revoquee_le      timestamptz,
  created_at       timestamptz not null default now()
);
create index api_cles_org_idx on public.api_cles (organisation_id);

-- Webhooks reçus (Stripe, Signabail, DocuSeal) : chaque événement traité une seule fois.
create table public.webhook_evenements (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('stripe', 'signabail', 'docuseal')),
  evenement_id text not null,
  type         text not null,
  payload      jsonb not null,
  traite_le    timestamptz,
  erreur       text,
  created_at   timestamptz not null default now(),
  unique (source, evenement_id)
);

-- Paramètres. « mode_test » = coupe-circuit : aucun e-mail, aucune signature,
-- aucun paiement réels tant qu'il vaut true. Actif par défaut.
create table public.parametres (
  cle     text primary key,
  valeur  jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.parametres (cle, valeur) values ('mode_test', 'true');

-- =============================================================================
-- Cycle de vie : brouillon → terminé → signé
-- Le navigateur ne peut pas écrire la colonne « statut » (voir migration 4) :
-- il passe par ces fonctions.
-- =============================================================================

-- Génération définitive : consomme un crédit (le brouillon est gratuit).
create function public.edl_finaliser(p_edl uuid) returns public.edl
language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  v_lot uuid;
  v_gratuit boolean;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or not private.est_membre(e.organisation_id) then
    raise exception 'État des lieux introuvable.' using errcode = '42501';
  end if;
  if e.statut <> 'brouillon' then
    raise exception 'Seul un brouillon peut être finalisé.' using errcode = 'P0001';
  end if;

  -- Déjà payé (EDL rouvert pour correction) ou relevé d'état sous Premium.
  v_gratuit := e.credit_consomme or (e.type = 'releve' and private.a_premium(e.organisation_id));

  if not v_gratuit then
    -- Les crédits réservés à ce type d'EDL d'abord, puis ceux qui expirent le plus tôt.
    select id into v_lot from public.credit_lots
    where organisation_id = e.organisation_id and restant > 0 and expire_le > now()
      and (type_reserve is null or type_reserve = e.type)
    order by (type_reserve is null), expire_le
    limit 1 for update;
    if v_lot is null then
      raise exception 'Aucun crédit disponible.' using errcode = 'P0002';
    end if;
    update public.credit_lots set restant = restant - 1 where id = v_lot;
    insert into public.credit_consommations (lot_id, organisation_id, edl_id)
    values (v_lot, e.organisation_id, e.id);
  end if;

  update public.edl
  set statut = 'termine', credit_consomme = credit_consomme or not v_gratuit, genere_le = now()
  where id = p_edl returning * into e;

  insert into public.edl_journal (edl_id, evenement, acteur_id, details)
  values (p_edl, 'finalise', (select auth.uid()), jsonb_build_object('lot', v_lot));
  return e;
end $$;

-- Retour en brouillon pour corriger, tant que personne n'a signé. Sans nouveau crédit.
create function public.edl_rouvrir(p_edl uuid) returns public.edl
language plpgsql security definer set search_path = '' as $$
declare e public.edl;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or not private.est_membre(e.organisation_id) then
    raise exception 'État des lieux introuvable.' using errcode = '42501';
  end if;
  if e.statut <> 'termine' then
    raise exception 'Seul un état des lieux terminé et non signé peut être rouvert.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl_signatures where edl_id = p_edl) then
    raise exception 'Une partie a déjà signé : l''état des lieux ne peut plus être rouvert.' using errcode = 'P0001';
  end if;
  update public.edl set statut = 'brouillon', pdf_path = null, pdf_sha256 = null, genere_le = null
  where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, acteur_id)
  values (p_edl, 'rouvert', (select auth.uid()));
  return e;
end $$;

-- Passage à « signé » : appelé par le serveur une fois toutes les signatures reçues.
create function public.edl_marquer_signe(p_edl uuid) returns public.edl
language plpgsql security definer set search_path = '' as $$
declare e public.edl;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or e.statut <> 'termine' or e.pdf_sha256 is null then
    raise exception 'L''état des lieux doit être terminé et son PDF généré.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.edl_parties p
    where p.edl_id = p_edl and p.doit_signer
      and not exists (select 1 from public.edl_signatures s
                      where s.partie_id = p.id and s.pdf_sha256 = e.pdf_sha256)
  ) then
    raise exception 'Toutes les parties n''ont pas signé ce document.' using errcode = 'P0001';
  end if;
  update public.edl set statut = 'signe', signe_le = now() where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, details)
  values (p_edl, 'signe', jsonb_build_object('pdf_sha256', e.pdf_sha256));
  return e;
end $$;
