-- =============================================================================
-- Constatio — 2/5 : logements et états des lieux
-- -----------------------------------------------------------------------------
-- Modèle relationnel (une ligne par pièce, par élément, par compteur…) pour
-- permettre la comparaison entrée / sortie et des règles d'accès fines.
-- Collab stocke la même information dans edl2.contenu (jsonb) : la fonction
-- export_collab_edl2 (migration 5) fait la conversion.
--
-- Contenu obligatoire de l'EDL — décret n° 2016-382 du 30 mars 2016, art. 2 :
--   type et date ............................ edl.type, edl.date_edl
--   localisation du logement ................ logements
--   parties et mandataires .................. edl_parties
--   relevés des compteurs ................... edl_compteurs
--   détail et destination des clés .......... edl_cles
--   description pièce par pièce ............. edl_pieces, edl_elements
--   signatures .............................. edl_signatures
--   sortie : nouvelle adresse du locataire .. edl_parties.nouvelle_adresse
--   sortie : date de l'EDL d'entrée ......... edl.date_edl_entree
-- =============================================================================

create type public.edl_type    as enum ('entrant', 'sortant', 'releve');
create type public.edl_statut  as enum ('brouillon', 'termine', 'signe');
create type public.bail_type   as enum ('vide', 'meuble', 'mobilite', 'etudiant', 'colocation', 'garage', 'autre');
create type public.partie_role as enum ('bailleur', 'locataire', 'mandataire_bailleur', 'mandataire_locataire');
create type public.etat_element as enum ('neuf', 'bon', 'usage', 'mauvais', 'hors_service');
create type public.compteur_type as enum ('electricite', 'gaz', 'eau_froide', 'eau_chaude');
create type public.cle_nature  as enum ('cle', 'badge', 'bip', 'telecommande', 'carte', 'autre');

-- Logement (équivalent du « lot » de Collab) ----------------------------------
create table public.logements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  libelle         text not null,                 -- « T2 rue des Balances »
  type_bien       text not null default 'appartement'
                  check (type_bien in ('studio', 'appartement', 'maison', 'garage', 'local', 'autre')),
  adresse         text not null,
  complement      text,                          -- bâtiment, étage, porte
  code_postal     text not null,
  ville           text not null,
  surface_m2      numeric(7, 2) check (surface_m2 > 0),
  nb_pieces       smallint,
  meuble          boolean not null default false,
  a_exterieur     boolean not null default false,
  collab_lot_id   text,                          -- lots.id dans Collab
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index logements_org_idx on public.logements (organisation_id);

-- État des lieux --------------------------------------------------------------
create table public.edl (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  logement_id       uuid not null references public.logements (id) on delete restrict,
  type              public.edl_type   not null,
  statut            public.edl_statut not null default 'brouillon',
  date_edl          timestamptz not null default now(),

  -- Sortie ou relevé : EDL d'entrée de référence. S'il n'a pas été fait sur
  -- Constatio, seule sa date est saisie (mention obligatoire en sortie).
  entree_id         uuid references public.edl (id) on delete set null,
  date_edl_entree   date,

  -- Rappel du bail (repris de Signabail lors d'un import).
  bail_type         public.bail_type not null default 'vide',
  bail_date_entree  date,
  depot_garantie_cents integer check (depot_garantie_cents >= 0),

  -- Personne qui réalise l'EDL (membre de l'organisation ou agent LOTIER).
  realise_par       uuid references auth.users (id) on delete set null,
  realise_par_nom   text not null default '',

  remarques_generales text,
  -- Début de la période de chauffe : ouvre le complément « chauffage »
  -- pendant un mois (loi du 6 juillet 1989, art. 3-2).
  debut_periode_chauffe date,
  grille_vetuste_id uuid,                        -- clé étrangère ajoutée en migration 3

  -- Document définitif. Renseigné par le serveur uniquement.
  credit_consomme   boolean not null default false,
  genere_le         timestamptz,
  pdf_path          text,
  pdf_sha256        text,
  signe_le          timestamptz,

  -- Provenance et rattachements externes.
  source            text not null default 'constatio'
                    check (source in ('constatio', 'signabail', 'collab', 'lotier_edl')),
  signabail_bail_id text,
  collab_edl_id     text,                        -- edl2.id dans Collab
  lotier_edl_ref    text,                        -- reprise de lotier-edl.com

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (type = 'entrant' or entree_id is distinct from id)
);
create index edl_org_idx      on public.edl (organisation_id, statut);
create index edl_logement_idx on public.edl (logement_id);
create index edl_entree_idx   on public.edl (entree_id);
create index edl_signabail_idx on public.edl (signabail_bail_id);

-- Parties et mandataires ------------------------------------------------------
create table public.edl_parties (
  id             uuid primary key default gen_random_uuid(),
  edl_id         uuid not null references public.edl (id) on delete cascade,
  role           public.partie_role not null,
  -- Mandataire : la partie qu'il représente et sa procuration.
  represente_id  uuid references public.edl_parties (id) on delete cascade,
  procuration_path text,
  civilite       text,
  prenom         text not null default '',
  nom            text not null,                  -- ou dénomination sociale
  email          text,
  telephone      text,
  adresse        text,
  -- EDL de sortie : nouveau domicile du locataire (mention obligatoire).
  nouvelle_adresse text,
  -- Compte Constatio de la partie, s'il existe : ouvre l'espace locataire.
  user_id        uuid references auth.users (id) on delete set null,
  collab_tenant_id text,                         -- tenants.id dans Collab
  doit_signer    boolean not null default true,
  ordre          smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((role in ('mandataire_bailleur', 'mandataire_locataire')) = (represente_id is not null))
);
create index edl_parties_edl_idx  on public.edl_parties (edl_id);
create index edl_parties_user_idx on public.edl_parties (user_id);

-- Pièces (intérieur) et zones extérieures ---------------------------------------
create table public.edl_pieces (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null references public.edl (id) on delete cascade,
  zone         text not null default 'interieur' check (zone in ('interieur', 'exterieur')),
  nom          text not null,                    -- « Séjour », « Chambre 2 », « Jardin »
  type_piece   text,                             -- code du modèle (sejour, cuisine, sdb, wc…)
  observations text,
  ordre        smallint not null default 0,
  -- Pièce correspondante dans l'EDL d'entrée (comparaison de sortie).
  origine_id   uuid references public.edl_pieces (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, edl_id)
);
create index edl_pieces_edl_idx on public.edl_pieces (edl_id, ordre);

-- Éléments d'une pièce : revêtements, équipements, rubriques du jardin ---------
create table public.edl_elements (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null,
  piece_id     uuid not null,
  categorie    text not null,                    -- code de ref_elements ou « autre »
  libelle      text not null,                    -- « Sol », « Fenêtre côté rue »
  nature       text,                             -- « parquet stratifié », « PVC double vitrage »
  etat         public.etat_element,              -- null = pas encore renseigné
  fonctionne   boolean,                          -- équipements : testé, fonctionne ?
  quantite     smallint,
  observations text,
  -- Texte de la dictée vocale avant relecture, et passages douteux signalés.
  dictee_brute text,
  dictee_doutes jsonb,
  ordre        smallint not null default 0,
  origine_id   uuid references public.edl_elements (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- La double clé garantit qu'un élément et sa pièce sont dans le même EDL.
  foreign key (piece_id, edl_id) references public.edl_pieces (id, edl_id) on delete cascade,
  unique (id, edl_id)
);
create index edl_elements_piece_idx on public.edl_elements (piece_id, ordre);
create index edl_elements_edl_idx   on public.edl_elements (edl_id);

-- Compteurs ---------------------------------------------------------------------
create table public.edl_compteurs (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null references public.edl (id) on delete cascade,
  type         public.compteur_type not null,
  -- « Pas de compteur individuel » ou « pas de gaz » : déclaré, pas laissé vide.
  absent       boolean not null default false,
  numero       text,                             -- n° de compteur, PDL / PCE
  double_tarif boolean not null default false,   -- électricité HP / HC
  index_1      numeric(12, 3),                   -- base ou heures pleines (kWh), m³
  index_2      numeric(12, 3),                   -- heures creuses
  emplacement  text,
  observations text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, edl_id),
  check (not absent or (index_1 is null and index_2 is null)),
  check (index_2 is null or double_tarif)
);
create index edl_compteurs_edl_idx on public.edl_compteurs (edl_id);

-- Clés et moyens d'accès ---------------------------------------------------------
create table public.edl_cles (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null references public.edl (id) on delete cascade,
  nature       public.cle_nature not null default 'cle',
  nombre       smallint not null check (nombre >= 0),
  destination  text not null,                    -- « porte palière », « boîte aux lettres », « portail »
  remis_a      uuid references public.edl_parties (id) on delete set null,
  observations text,
  ordre        smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index edl_cles_edl_idx on public.edl_cles (edl_id);

-- Inventaire du mobilier (meublés) -------------------------------------------------
-- Liste minimale du décret n° 2015-981 du 31 juillet 2015, art. 2.
create table public.ref_mobilier_decret (
  code    text primary key,
  libelle text not null,
  ordre   smallint not null
);
insert into public.ref_mobilier_decret (code, libelle, ordre) values
  ('literie',      'Literie comprenant couette ou couverture', 1),
  ('occultation',  'Dispositif d''occultation des fenêtres dans les chambres', 2),
  ('plaques',      'Plaques de cuisson', 3),
  ('four',         'Four ou four à micro-ondes', 4),
  ('refrigerateur','Réfrigérateur et congélateur, ou réfrigérateur avec compartiment à −6 °C au plus', 5),
  ('vaisselle',    'Vaisselle nécessaire à la prise des repas', 6),
  ('ustensiles',   'Ustensiles de cuisine', 7),
  ('table_sieges', 'Table et sièges', 8),
  ('rangements',   'Étagères de rangement', 9),
  ('luminaires',   'Luminaires', 10),
  ('entretien',    'Matériel d''entretien ménager adapté au logement', 11);

create table public.edl_inventaire (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null references public.edl (id) on delete cascade,
  piece_id     uuid references public.edl_pieces (id) on delete set null,
  -- Renseigné quand la ligne couvre un équipement de la liste minimale.
  code_decret  text references public.ref_mobilier_decret (code),
  libelle      text not null,
  quantite     smallint not null default 1 check (quantite >= 0),
  etat         public.etat_element,
  observations text,
  ordre        smallint not null default 0,
  origine_id   uuid references public.edl_inventaire (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index edl_inventaire_edl_idx on public.edl_inventaire (edl_id);

-- Photos ------------------------------------------------------------------------
-- Le fichier est dans Supabase Storage (bucket « edl ») ; Collab le stocke en
-- base64 dans edl2_photos.data, l'export fait la conversion.
create table public.edl_photos (
  id           uuid primary key default gen_random_uuid(),
  edl_id       uuid not null references public.edl (id) on delete cascade,
  piece_id     uuid,
  element_id   uuid,
  compteur_id  uuid,
  storage_path text not null unique,             -- {organisation}/{edl}/photos/{id}.jpg
  nom          text not null default '',
  mime         text not null default 'image/jpeg',
  taille       integer not null check (taille > 0),
  largeur      integer,
  hauteur      integer,
  sha256       text not null,                    -- empreinte du fichier, calculée sur l'appareil
  pris_le      timestamptz not null,             -- horloge de l'appareil
  recu_le      timestamptz not null default now(), -- horloge du serveur, à la synchronisation
  latitude     double precision,
  longitude    double precision,
  precision_m  real,
  legende      text,
  created_at   timestamptz not null default now(),
  foreign key (piece_id, edl_id)    references public.edl_pieces (id, edl_id)    on delete cascade,
  foreign key (element_id, edl_id)  references public.edl_elements (id, edl_id)  on delete cascade,
  foreign key (compteur_id, edl_id) references public.edl_compteurs (id, edl_id) on delete cascade
);
create index edl_photos_edl_idx     on public.edl_photos (edl_id);
create index edl_photos_element_idx on public.edl_photos (element_id);

-- Signatures --------------------------------------------------------------------
create table public.edl_signatures (
  id            uuid primary key default gen_random_uuid(),
  edl_id        uuid not null references public.edl (id) on delete cascade,
  partie_id     uuid not null unique references public.edl_parties (id) on delete cascade,
  mode          text not null check (mode in ('sur_place', 'a_distance')),
  signe_le      timestamptz not null default now(),
  pdf_sha256    text not null,                   -- empreinte du document signé
  image_path    text,                            -- tracé de la signature manuscrite
  ip            inet,
  user_agent    text,
  fournisseur   text,                            -- « docuseal »
  fournisseur_ref text
);
create index edl_signatures_edl_idx on public.edl_signatures (edl_id);

-- Liens à usage unique envoyés aux parties sans compte (signature à distance,
-- demande de complément). Seule l'empreinte du jeton est conservée.
create table public.edl_jetons (
  id         uuid primary key default gen_random_uuid(),
  edl_id     uuid not null references public.edl (id) on delete cascade,
  partie_id  uuid not null references public.edl_parties (id) on delete cascade,
  usage      text not null check (usage in ('signature', 'complement')),
  jeton_hash text not null unique,
  expire_le  timestamptz not null,
  utilise_le timestamptz,
  created_at timestamptz not null default now()
);

-- Complément d'EDL d'entrée (art. 3-2) ---------------------------------------------
--   « general »   : dans les 10 jours qui suivent l'établissement de l'EDL ;
--   « chauffage » : pendant le premier mois de la période de chauffe.
create table public.edl_complements (
  id          uuid primary key default gen_random_uuid(),
  edl_id      uuid not null references public.edl (id) on delete cascade,
  type        text not null check (type in ('general', 'chauffage')),
  partie_id   uuid references public.edl_parties (id) on delete set null,
  element_id  uuid references public.edl_elements (id) on delete set null,
  texte       text not null,
  photo_paths text[] not null default '{}',
  statut      text not null default 'demande' check (statut in ('demande', 'accepte', 'refuse')),
  reponse     text,
  repondu_le  timestamptz,
  created_at  timestamptz not null default now()
);
create index edl_complements_edl_idx on public.edl_complements (edl_id);

-- Journal de preuve : ajout seul ---------------------------------------------------
create table public.edl_journal (
  id         bigint generated always as identity primary key,
  edl_id     uuid not null references public.edl (id) on delete cascade,
  evenement  text not null,                      -- cree, finalise, rouvert, pdf_genere, lien_envoye, signe, complement…
  acteur_id  uuid,
  acteur_nom text,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index edl_journal_edl_idx on public.edl_journal (edl_id, created_at);

-- Référentiel des éléments proposés par défaut (codes stables pour l'export) -------
create table public.ref_elements (
  code    text primary key,
  zone    text not null check (zone in ('interieur', 'exterieur')),
  libelle text not null,
  ordre   smallint not null
);
insert into public.ref_elements (code, zone, libelle, ordre) values
  ('sol', 'interieur', 'Sol', 1),
  ('murs', 'interieur', 'Murs', 2),
  ('plafond', 'interieur', 'Plafond', 3),
  ('menuiseries', 'interieur', 'Portes, fenêtres et volets', 4),
  ('electricite', 'interieur', 'Prises, interrupteurs et éclairage', 5),
  ('plomberie', 'interieur', 'Plomberie et sanitaires', 6),
  ('chauffage', 'interieur', 'Chauffage', 7),
  ('equipements', 'interieur', 'Équipements', 8),
  ('rangements', 'interieur', 'Placards et rangements', 9),
  ('pelouse', 'exterieur', 'Pelouse', 20),
  ('arbres', 'exterieur', 'Arbres', 21),
  ('haies', 'exterieur', 'Haies et arbustes', 22),
  ('massifs', 'exterieur', 'Massifs', 23),
  ('potager', 'exterieur', 'Potager', 24),
  ('invasives', 'exterieur', 'Palmiers, bambous et plantes invasives', 25),
  ('arrosage', 'exterieur', 'Arrosage automatique', 26),
  ('clotures', 'exterieur', 'Clôtures, murs et portails', 27),
  ('terrasses', 'exterieur', 'Terrasses, dallages et allées', 28),
  ('abris', 'exterieur', 'Abris et dépendances', 29),
  ('piscine', 'exterieur', 'Piscine et spa', 30),
  ('eclairage_ext', 'exterieur', 'Éclairage extérieur', 31),
  ('eau_compost', 'exterieur', 'Récupération d''eau et compost', 32),
  ('proprete', 'exterieur', 'Propreté générale', 33),
  ('observations_ext', 'exterieur', 'Observations libres', 34);

-- updated_at ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['logements', 'edl', 'edl_parties', 'edl_pieces', 'edl_elements',
                           'edl_compteurs', 'edl_cles', 'edl_inventaire'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- =============================================================================
-- Verrouillage après signature
-- Un EDL signé n'est plus modifiable par personne, compte de service compris :
-- c'est une garantie de la base, pas seulement de l'interface.
-- =============================================================================
create function private.verrou_enfant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_edl    uuid := case when tg_op = 'DELETE' then old.edl_id else new.edl_id end;
  v_statut public.edl_statut;
begin
  -- Lors d'une purge (suppression de l'EDL lui-même), la ligne parente n'existe
  -- déjà plus : v_statut reste null et la suppression en cascade passe.
  select statut into v_statut from public.edl where id = v_edl;
  if v_statut = 'signe' then
    raise exception 'État des lieux signé : il ne peut plus être modifié.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['edl_parties', 'edl_pieces', 'edl_elements', 'edl_compteurs',
                           'edl_cles', 'edl_inventaire', 'edl_photos'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.verrou_enfant()', t || '_verrou', t);
  end loop;
end $$;

-- Sur l'EDL signé, seuls les rattachements externes restent modifiables.
-- La suppression n'est possible que par la purge RGPD (set local app.purge = 'on').
create function private.verrou_edl() returns trigger
language plpgsql set search_path = '' as $$
declare
  libres text[] := array['collab_edl_id', 'signabail_bail_id', 'debut_periode_chauffe', 'updated_at'];
begin
  -- Un crédit réservé à un type d'EDL ne sert pas à en payer un autre.
  if tg_op = 'UPDATE' and old.credit_consomme and new.type <> old.type then
    raise exception 'Le type d''un état des lieux déjà généré ne se change pas.' using errcode = 'P0001';
  end if;
  if old.statut = 'signe' then
    if tg_op = 'DELETE' then
      if coalesce(current_setting('app.purge', true), '') <> 'on' then
        raise exception 'État des lieux signé : suppression réservée à la purge.' using errcode = 'P0001';
      end if;
      return old;
    end if;
    if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
      raise exception 'État des lieux signé : il ne peut plus être modifié.' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger edl_verrou before update or delete on public.edl
  for each row execute function private.verrou_edl();

-- Signatures : jamais modifiées ; jamais retirées d'un EDL signé.
create function private.verrou_signature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une signature ne se modifie pas.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl where id = old.edl_id and statut = 'signe') then
    raise exception 'État des lieux signé : il ne peut plus être modifié.' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger edl_signatures_verrou before update or delete on public.edl_signatures
  for each row execute function private.verrou_signature();

-- Journal : ajout seul (la purge de l'EDL emporte son journal).
create function private.verrou_journal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.edl where id = old.edl_id) then
    return old;
  end if;
  raise exception 'Le journal de preuve ne se modifie pas.' using errcode = 'P0001';
end $$;
create trigger edl_journal_verrou before update or delete on public.edl_journal
  for each row execute function private.verrou_journal();

-- Complément : uniquement sur un EDL d'entrée signé, et dans le délai légal.
create function private.controle_complement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.edl;
begin
  select * into e from public.edl where id = new.edl_id;
  if e.type <> 'entrant' or e.statut <> 'signe' then
    raise exception 'Le complément ne concerne qu''un état des lieux d''entrée signé.' using errcode = 'P0001';
  end if;
  if new.type = 'general' and now() > e.signe_le + interval '10 days' then
    raise exception 'Le délai de 10 jours pour compléter l''état des lieux est dépassé.' using errcode = 'P0001';
  end if;
  if new.type = 'chauffage' and (e.debut_periode_chauffe is null
       or now() < e.debut_periode_chauffe
       or now() > e.debut_periode_chauffe + interval '1 month') then
    raise exception 'Le complément chauffage n''est ouvert que pendant le premier mois de la période de chauffe.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger edl_complements_controle before insert on public.edl_complements
  for each row execute function private.controle_complement();
