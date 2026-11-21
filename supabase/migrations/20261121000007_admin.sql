-- =============================================================================
-- Constatio — 7 : administration du service
-- -----------------------------------------------------------------------------
-- Deux rôles : « admin » (suivi des comptes, crédits, tarifs) et « superadmin »
-- (en plus : mode test, désignation des administrateurs).
--
-- Principes :
--   * tout passe par des fonctions qui vérifient le rôle DANS la base : masquer un
--     bouton ne protège rien, c'est la fonction qui refuse ;
--   * un administrateur voit les comptes et les chiffres, PAS le contenu des états
--     des lieux ni les photos : les règles d'accès des tables ne changent pas ;
--   * chaque action d'administration est inscrite dans un journal en ajout seul ;
--   * le premier super administrateur est désigné au déploiement par le serveur
--     (admin_designer) : aucune adresse n'est écrite dans le code.
-- =============================================================================

create table public.administrateurs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'superadmin')),
  ajoute_par uuid,
  created_at timestamptz not null default now()
);
create table public.admin_journal (
  id          bigint generated always as identity primary key,
  admin_id    uuid,
  admin_email text,
  action      text not null,
  cible       text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index admin_journal_date_idx on public.admin_journal (created_at desc);
alter table public.administrateurs enable row level security;
alter table public.admin_journal enable row level security;
revoke all on public.administrateurs, public.admin_journal from anon, authenticated;

create function private.verrou_admin_journal() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Le journal d''administration ne se modifie pas.' using errcode = 'P0001';
end $$;
create trigger admin_journal_verrou before update or delete on public.admin_journal
  for each row execute function private.verrou_admin_journal();

create function private.role_admin() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.administrateurs where user_id = (select auth.uid())
$$;

/** Refuse quiconque n'est pas administrateur (ou super administrateur si demandé). */
create function private.exiger_admin(p_super boolean default false) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.role_admin();
begin
  if v_role is null or (p_super and v_role <> 'superadmin') then
    raise exception '%', case when p_super then 'Réservé au super administrateur.' else 'Réservé aux administrateurs.' end using errcode = '42501';
  end if;
end $$;

create function private.journal_admin(p_action text, p_cible text, p_details jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_journal (admin_id, admin_email, action, cible, details)
  values ((select auth.uid()), (select email from auth.users where id = (select auth.uid())), p_action, p_cible, p_details)
$$;

-- ── Désignation des administrateurs ───────────────────────────────────────────
/** Au déploiement, par le serveur : désigne un administrateur à partir de son adresse. Le compte doit exister. */
create function public.admin_designer(p_email text, p_role text default 'superadmin') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Aucun compte avec cette adresse : créez-le d''abord.' using errcode = 'P0002'; end if;
  insert into public.administrateurs (user_id, role) values (v_user, p_role)
  on conflict (user_id) do update set role = excluded.role;
  insert into public.admin_journal (action, cible, details) values ('admin.designe_par_le_serveur', p_email, jsonb_build_object('role', p_role));
  return v_user;
end $$;

/** Par le super administrateur : donne, change ou retire (rôle null) un rôle d'administration. */
create function public.admin_definir_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform private.exiger_admin(true);
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Aucun compte avec cette adresse.' using errcode = 'P0002'; end if;
  if v_user = (select auth.uid()) then raise exception 'Vous ne pouvez pas modifier votre propre rôle.' using errcode = 'P0001'; end if;
  if p_role is null then
    delete from public.administrateurs where user_id = v_user;
  else
    insert into public.administrateurs (user_id, role, ajoute_par) values (v_user, p_role, (select auth.uid()))
    on conflict (user_id) do update set role = excluded.role;
  end if;
  perform private.journal_admin('admin.role', p_email, jsonb_build_object('role', p_role));
end $$;

/** Pour l'interface : le rôle de la personne connectée, ou null. */
create function public.admin_moi() returns text
language sql stable security definer set search_path = '' as $$ select private.role_admin() $$;

-- ── Lecture ────────────────────────────────────────────────────────────────────
create function public.admin_tableau_de_bord() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  return jsonb_build_object(
    'mode_test', (select valeur from public.parametres where cle = 'mode_test'),
    'comptes', (select count(*) from public.organisations where not est_test),
    'comptes_7j', (select count(*) from public.organisations where not est_test and created_at > now() - interval '7 days'),
    'comptes_test', (select count(*) from public.organisations where est_test),
    'edl', (select coalesce(jsonb_object_agg(statut, n), '{}') from (select statut, count(*) n from public.edl group by statut) s),
    'edl_30j', (select count(*) from public.edl where created_at > now() - interval '30 days'),
    'credits_en_circulation', (select coalesce(sum(restant), 0) from public.credit_lots where expire_le > now()),
    'credits_consommes_30j', (select count(*) from public.credit_consommations where created_at > now() - interval '30 days'),
    'credits_offerts_signabail', (select coalesce(sum(quantite), 0) from public.credit_lots where origine = 'signabail'),
    'abonnements_actifs', (select count(*) from public.abonnements where statut = 'actif' and periode_fin > now()),
    'reservations_a_traiter', (select count(*) from public.reservations where statut in ('payee', 'planifiee')),
    'signabail_en_attente', (select count(*) from public.webhook_evenements where source = 'signabail' and traite_le is null),
    'signabail_en_erreur', (select count(*) from public.webhook_evenements where source = 'signabail' and erreur is not null),
    'comptes_lies_signabail', (select count(*) from public.organisations where signabail_compte_id is not null));
end $$;

create function public.admin_comptes(p_recherche text default null, p_limite integer default 50, p_decalage integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_motif text := nullif(trim(coalesce(p_recherche, '')), '');
begin
  perform private.exiger_admin();
  return coalesce((
    select jsonb_agg(c order by c ->> 'cree_le' desc) from (
      select jsonb_build_object(
        'id', o.id, 'nom', o.nom, 'type', o.type, 'est_test', o.est_test, 'cree_le', o.created_at,
        'email', (select u.email from public.organisation_membres m join auth.users u on u.id = m.user_id
                  where m.organisation_id = o.id and m.role = 'proprietaire' limit 1),
        'nb_edl', (select count(*) from public.edl e where e.organisation_id = o.id),
        'credits', (select coalesce(sum(l.restant), 0) from public.credit_lots l where l.organisation_id = o.id and l.expire_le > now()),
        'premium', private.a_premium(o.id), 'signabail', o.signabail_compte_id is not null) as c
      from public.organisations o
      where v_motif is null or o.nom ilike '%' || v_motif || '%'
         or exists (select 1 from public.organisation_membres m join auth.users u on u.id = m.user_id
                    where m.organisation_id = o.id and u.email ilike '%' || v_motif || '%')
      order by o.created_at desc
      limit least(greatest(p_limite, 1), 100) offset greatest(p_decalage, 0)
    ) s), '[]');
end $$;

/** Le détail d'un compte : identité, membres, crédits, et la LISTE de ses états des lieux (sans leur contenu). */
create function public.admin_compte(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  return (select jsonb_build_object(
    'organisation', jsonb_build_object('id', o.id, 'nom', o.nom, 'type', o.type, 'siret', o.siret, 'ville', o.ville,
                                       'est_test', o.est_test, 'cree_le', o.created_at, 'signabail', o.signabail_compte_id is not null),
    'membres', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role, 'depuis', m.created_at) order by m.created_at)
                         from public.organisation_membres m join auth.users u on u.id = m.user_id where m.organisation_id = o.id), '[]'),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'origine', l.origine, 'quantite', l.quantite, 'restant', l.restant,
                                                         'type_reserve', l.type_reserve, 'expire_le', l.expire_le, 'cree_le', l.created_at) order by l.created_at desc)
                      from public.credit_lots l where l.organisation_id = o.id), '[]'),
    'edl', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'statut', e.statut, 'date', e.date_edl,
                                                        'ville', g.ville, 'source', e.source) order by e.created_at desc)
                     from public.edl e join public.logements g on g.id = e.logement_id where e.organisation_id = o.id), '[]'),
    'premium', private.a_premium(o.id))
  from public.organisations o where o.id = p_org);
end $$;

create function public.admin_tarifs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  return (select jsonb_agg(to_jsonb(t) order by t.periodicite desc, t.montant_cents) from public.tarifs t);
end $$;

/** Les messages reçus de Signabail, sans leur contenu (données personnelles du bail). */
create function public.admin_signabail(p_seulement_a_traiter boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  return coalesce((select jsonb_agg(x order by x ->> 'recu_le' desc) from (
    select jsonb_build_object('id', w.id, 'type', w.type, 'recu_le', w.created_at, 'traite_le', w.traite_le, 'erreur', w.erreur,
                              'compte', w.payload #>> '{compte,id}', 'bail', w.payload #>> '{bail,id}', 'test', coalesce((w.payload ->> 'test')::boolean, false),
                              'compte_lie', exists (select 1 from public.organisations o where o.signabail_compte_id = w.payload #>> '{compte,id}')) x
    from public.webhook_evenements w
    where w.source = 'signabail' and (not p_seulement_a_traiter or w.traite_le is null or w.erreur is not null)
    order by w.created_at desc limit 200) s), '[]');
end $$;

create function public.admin_journal_lire(p_limite integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  return coalesce((select jsonb_agg(to_jsonb(j) order by j.id desc) from (
    select id, admin_email, action, cible, details, created_at from public.admin_journal order by id desc limit least(greatest(p_limite, 1), 500)) j), '[]');
end $$;

create function public.admin_administrateurs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  return coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', a.role, 'depuis', a.created_at) order by a.created_at)
                   from public.administrateurs a join auth.users u on u.id = a.user_id), '[]');
end $$;

-- ── Actions (toutes journalisées) ─────────────────────────────────────────────
/** Geste commercial : des crédits valables 24 mois. Le motif est obligatoire. */
create function public.admin_offrir_credits(p_org uuid, p_quantite integer, p_motif text, p_type_reserve public.edl_type default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_lot uuid;
begin
  perform private.exiger_admin();
  if p_quantite is null or p_quantite < 1 or p_quantite > 50 then raise exception 'De 1 à 50 crédits à la fois.' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_motif, '')), '') is null then raise exception 'Indiquez le motif du geste commercial.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.organisations where id = p_org) then raise exception 'Compte introuvable.' using errcode = 'P0002'; end if;
  insert into public.credit_lots (organisation_id, origine, quantite, restant, type_reserve, expire_le)
  values (p_org, 'geste_commercial', p_quantite, p_quantite, p_type_reserve, now() + interval '24 months') returning id into v_lot;
  perform private.journal_admin('credits.offerts', p_org::text, jsonb_build_object('quantite', p_quantite, 'motif', trim(p_motif), 'type_reserve', p_type_reserve, 'lot', v_lot));
  return v_lot;
end $$;

/** Retire ce qui reste d'un lot (erreur de saisie, remboursement). Les crédits déjà consommés ne changent pas. */
create function public.admin_annuler_lot(p_lot uuid, p_motif text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_restant integer; v_org uuid;
begin
  perform private.exiger_admin();
  if nullif(trim(coalesce(p_motif, '')), '') is null then raise exception 'Indiquez le motif.' using errcode = 'P0001'; end if;
  select restant, organisation_id into v_restant, v_org from public.credit_lots where id = p_lot for update;
  if not found then raise exception 'Lot introuvable.' using errcode = 'P0002'; end if;
  update public.credit_lots set restant = 0 where id = p_lot;
  perform private.journal_admin('credits.retires', v_org::text, jsonb_build_object('lot', p_lot, 'retires', v_restant, 'motif', trim(p_motif)));
  return v_restant;
end $$;

create function public.admin_definir_test(p_org uuid, p_test boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exiger_admin();
  update public.organisations set est_test = p_test where id = p_org;
  if not found then raise exception 'Compte introuvable.' using errcode = 'P0002'; end if;
  perform private.journal_admin('compte.test', p_org::text, jsonb_build_object('est_test', p_test));
end $$;

create function public.admin_modifier_tarif(p_code text, p_montant_cents integer, p_credits integer, p_actif boolean, p_libelle text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_avant public.tarifs;
begin
  perform private.exiger_admin();
  if p_montant_cents is null or p_montant_cents < 0 or p_montant_cents > 1000000 then raise exception 'Montant invalide.' using errcode = 'P0001'; end if;
  if p_credits is null or p_credits < 0 or p_credits > 1000 then raise exception 'Nombre de crédits invalide.' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_libelle, '')), '') is null then raise exception 'Le libellé est obligatoire.' using errcode = 'P0001'; end if;
  select * into v_avant from public.tarifs where code = p_code for update;
  if not found then raise exception 'Tarif introuvable.' using errcode = 'P0002'; end if;
  update public.tarifs set montant_cents = p_montant_cents, credits = p_credits, actif = p_actif, libelle = trim(p_libelle) where code = p_code;
  perform private.journal_admin('tarif.modifie', p_code, jsonb_build_object(
    'avant', jsonb_build_object('montant_cents', v_avant.montant_cents, 'credits', v_avant.credits, 'actif', v_avant.actif, 'libelle', v_avant.libelle),
    'apres', jsonb_build_object('montant_cents', p_montant_cents, 'credits', p_credits, 'actif', p_actif, 'libelle', trim(p_libelle))));
end $$;

/** Coupe-circuit. Le désactiver autorise e-mails, signatures et paiements réels : super administrateur seulement. */
create function public.admin_mode_test(p_actif boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  update public.parametres set valeur = to_jsonb(p_actif), updated_at = now() where cle = 'mode_test';
  perform private.journal_admin('mode_test', null, jsonb_build_object('actif', p_actif));
end $$;

/** Retraite un message Signabail resté en attente ou en erreur. */
create function public.admin_rejouer_signabail(p_evenement uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_issue text;
begin
  perform private.exiger_admin();
  update public.webhook_evenements set traite_le = null, erreur = null where id = p_evenement and source = 'signabail';
  if not found then raise exception 'Message introuvable.' using errcode = 'P0002'; end if;
  v_issue := private.signabail_traiter(p_evenement);
  perform private.journal_admin('signabail.rejoue', p_evenement::text, jsonb_build_object('issue', v_issue));
  return v_issue;
end $$;

-- Droits : les fonctions vérifient elles-mêmes le rôle ; un visiteur non connecté n'y accède pas du tout.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'admin\_%' loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on function public.admin_designer(text, text) from authenticated;
