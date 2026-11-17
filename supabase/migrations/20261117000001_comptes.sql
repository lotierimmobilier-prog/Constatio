-- =============================================================================
-- Constatio — 1/5 : comptes, organisations, membres
-- -----------------------------------------------------------------------------
-- Conventions valables pour toutes les migrations :
--   * noms en français, snake_case ; montants en centimes (integer) ;
--   * clés primaires uuid générées côté client OU serveur : l'application hors
--     connexion crée ses lignes avec leur identifiant définitif, la
--     synchronisation est un simple upsert (dernière écriture gagnante sur
--     updated_at) ;
--   * toute donnée appartient à une « organisation » (le compte : particulier,
--     SCI ou professionnel). Les droits passent par l'appartenance à
--     l'organisation, jamais par un user_id posé sur chaque ligne ;
--   * les fonctions d'aide aux règles RLS vivent dans le schéma « private »,
--     qui n'est pas exposé par l'API.
-- =============================================================================

create schema if not exists private;

create type public.organisation_type as enum ('particulier', 'sci', 'pro');
create type public.membre_role       as enum ('proprietaire', 'admin', 'agent');

-- Profil de la personne connectée (1 ligne par auth.users) --------------------
create table public.profils (
  id            uuid primary key references auth.users (id) on delete cascade,
  prenom        text not null default '',
  nom           text not null default '',
  telephone     text,
  -- Identifiant du compte Signabail lié par « Se connecter avec Signabail ».
  signabail_sub text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Organisation = le compte client --------------------------------------------
create table public.organisations (
  id                 uuid primary key default gen_random_uuid(),
  type               public.organisation_type not null default 'particulier',
  nom                text not null,
  siret              text,
  adresse            text,
  code_postal        text,
  ville              text,
  -- Professionnels : carte professionnelle (mention obligatoire sur l'EDL
  -- lorsqu'un mandataire intervient).
  carte_pro_numero   text,
  carte_pro_cci      text,
  -- Marque blanche (Premium Pro).
  logo_path          text,
  entete             text,
  pied_de_page       text,
  -- Compte Signabail rattaché (crédits offerts, remise sur abonnements).
  signabail_compte_id text unique,
  -- Jeu de données de recette (préfixe « ZZREC ») : jamais d'e-mail, de
  -- signature ni de paiement réels pour ces comptes.
  est_test           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.organisation_membres (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.membre_role not null default 'agent',
  created_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index organisation_membres_user_idx on public.organisation_membres (user_id);

-- Données de facturation : jamais lisibles ni modifiables depuis le navigateur.
create table public.organisation_facturation (
  organisation_id    uuid primary key references public.organisations (id) on delete cascade,
  stripe_customer_id text unique,
  updated_at         timestamptz not null default now()
);

-- Outils communs --------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profils_touch       before update on public.profils
  for each row execute function private.touch_updated_at();
create trigger organisations_touch before update on public.organisations
  for each row execute function private.touch_updated_at();

-- Appartenance : SECURITY DEFINER pour que les règles RLS puissent interroger
-- organisation_membres sans se rappeler elles-mêmes (récursion).
create function private.est_membre(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_membres m
    where m.organisation_id = p_org and m.user_id = (select auth.uid())
  )
$$;

create function private.est_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_membres m
    where m.organisation_id = p_org and m.user_id = (select auth.uid())
      and m.role in ('proprietaire', 'admin')
  )
$$;

-- À l'inscription : un profil, une organisation personnelle, un rôle
-- propriétaire. L'utilisateur peut faire un EDL sans autre démarche.
create function private.nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_nom text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nom'), ''), split_part(new.email, '@', 1), 'Mon compte');
begin
  insert into public.profils (id, prenom, nom)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'prenom', ''), coalesce(new.raw_user_meta_data ->> 'nom', ''));

  insert into public.organisations (nom, type)
  values (v_nom, coalesce((new.raw_user_meta_data ->> 'type_compte')::public.organisation_type, 'particulier'))
  returning id into v_org;

  insert into public.organisation_membres (organisation_id, user_id, role)
  values (v_org, new.id, 'proprietaire');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.nouvel_utilisateur();
