-- Mise à jour de la base Constatio : migration 17 (équipe d'un compte professionnel).
-- À coller dans Supabase > SQL Editor du projet CONSTATIO, puis « Run ». Une seule fois.
-- À passer APRÈS le fichier des migrations 10 à 16.
begin;

-- =============================================================================
-- Constatio — 17 : équipe d'un compte professionnel
-- -----------------------------------------------------------------------------
-- Une agence a un administrateur (le titulaire du compte, ou un membre nommé
-- administrateur) et des collaborateurs — ses commerciaux. Un collaborateur a
-- son propre identifiant ; il saisit des états des lieux, et rien d'autre :
--   * jamais d'accès à la facturation (crédits, abonnement, achats, factures) ;
--   * pas de réglage du compte ni de l'équipe ;
--   * des droits que l'administrateur accorde ou retire, un par un :
--       generer    finaliser un document (ce qui utilise un crédit du compte)
--       voir_tous  voir les états des lieux de ses collègues (sinon, seulement les siens)
--       supprimer  supprimer un brouillon
-- Tout est tenu par la base : l'écran ne fait que le refléter.
-- Un collaborateur rejoint l'équipe par un lien d'invitation à usage unique,
-- dont seule l'empreinte est conservée.
-- =============================================================================
alter table public.organisation_membres
  add column droits jsonb not null default '{"generer": true, "voir_tous": true, "supprimer": false}';

/** Vrai pour le titulaire et les administrateurs ; pour un collaborateur, selon le droit accordé. */
create function private.a_droit(p_org uuid, p_droit text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_membres m
    where m.organisation_id = p_org and m.user_id = (select auth.uid())
      and (m.role in ('proprietaire', 'admin') or coalesce((m.droits ->> p_droit)::boolean, false)))
$$;

-- Visibilité : un collaborateur sans « voir_tous » ne voit que les états des lieux qu'il réalise.
create or replace function private.edl_lisible(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl e
    where e.id = p_edl and (
      (private.est_membre(e.organisation_id) and (private.a_droit(e.organisation_id, 'voir_tous') or e.realise_par = (select auth.uid())))
      or (e.statut = 'signe' and exists (
            select 1 from public.edl_parties p
            where p.edl_id = e.id and p.user_id = (select auth.uid())))
    )
  )
$$;
create or replace function private.edl_modifiable(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl e
    where e.id = p_edl and e.statut = 'brouillon' and private.est_membre(e.organisation_id)
      and (private.a_droit(e.organisation_id, 'voir_tous') or e.realise_par = (select auth.uid()))
  )
$$;

-- Finaliser (un crédit du compte) et supprimer : selon le droit du collaborateur.
-- Sans utilisateur connecté (serveur, purge), ces règles ne s'appliquent pas.
create function private.controle_droits_edl() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    if private.est_membre(old.organisation_id) and not private.a_droit(old.organisation_id, 'supprimer') then
      raise exception 'Votre administrateur ne vous a pas donné le droit de supprimer un état des lieux.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.statut = 'brouillon' and new.statut = 'termine' and private.est_membre(new.organisation_id) and not private.a_droit(new.organisation_id, 'generer') then
    raise exception 'Votre administrateur ne vous a pas donné le droit de générer le document définitif.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger edl_droits before update or delete on public.edl
  for each row execute function private.controle_droits_edl();

-- Facturation : réservée au titulaire et aux administrateurs.
drop policy credit_lots_lecture on public.credit_lots;
create policy credit_lots_lecture on public.credit_lots for select to authenticated using (private.est_admin(organisation_id));
drop policy credit_consommations_lecture on public.credit_consommations;
create policy credit_consommations_lecture on public.credit_consommations for select to authenticated using (private.est_admin(organisation_id));
drop policy abonnements_lecture on public.abonnements;
create policy abonnements_lecture on public.abonnements for select to authenticated using (private.est_admin(organisation_id));

-- Invitations -------------------------------------------------------------------
create table public.organisation_invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  jeton_hash      text not null unique,
  nom             text not null,                       -- pour qui : « Paul Durand »
  droits          jsonb not null,
  expire_le       timestamptz not null,
  utilisee_le     timestamptz,
  utilisee_par    uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.organisation_invitations enable row level security;
grant select, delete on public.organisation_invitations to authenticated;
create policy invitations_lecture on public.organisation_invitations for select to authenticated using (private.est_admin(organisation_id));
create policy invitations_retrait on public.organisation_invitations for delete to authenticated using (private.est_admin(organisation_id) and utilisee_le is null);

create function private.droits_propres(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('generer', coalesce((p ->> 'generer')::boolean, false), 'voir_tous', coalesce((p ->> 'voir_tous')::boolean, false), 'supprimer', coalesce((p ->> 'supprimer')::boolean, false))
$$;

/** L'administrateur d'un compte professionnel prépare une invitation. Le jeton reste chez lui ; la base n'en garde que l'empreinte. */
create function public.equipe_inviter(p_nom text, p_jeton_hash text, p_droits jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_fin timestamptz := now() + interval '7 days';
begin
  select m.organisation_id into v_org from public.organisation_membres m join public.organisations o on o.id = m.organisation_id
  where m.user_id = (select auth.uid()) and m.role in ('proprietaire', 'admin') and o.type = 'pro' limit 1;
  if v_org is null then raise exception 'Les équipes sont réservées aux administrateurs d''un compte professionnel.' using errcode = '42501'; end if;
  if btrim(coalesce(p_nom, '')) = '' or p_jeton_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invitation incomplète.' using errcode = 'P0001'; end if;
  insert into public.organisation_invitations (organisation_id, jeton_hash, nom, droits, expire_le, created_by)
  values (v_org, p_jeton_hash, btrim(p_nom), private.droits_propres(p_droits), v_fin, (select auth.uid()));
  return v_fin;
end $$;

/** Ce que voit la personne invitée avant de rejoindre : le nom de l'agence. Rien d'autre. */
create function public.equipe_invitation(p_jeton text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('agence', o.nom, 'pour', i.nom)
  from public.organisation_invitations i join public.organisations o on o.id = i.organisation_id
  where i.jeton_hash = encode(sha256(convert_to(p_jeton, 'UTF8')), 'hex') and i.utilisee_le is null and i.expire_le > now()
$$;

/** La personne invitée, connectée à son propre compte, rejoint l'équipe. Son compte personnel vide est refermé. */
create function public.equipe_rejoindre(p_jeton text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.organisation_invitations;
  v_moi uuid := (select auth.uid());
  v_ancien uuid;
begin
  if v_moi is null then raise exception 'Connectez-vous pour rejoindre l''équipe.' using errcode = '42501'; end if;
  select * into i from public.organisation_invitations
  where jeton_hash = encode(sha256(convert_to(p_jeton, 'UTF8')), 'hex') and utilisee_le is null and expire_le > now() for update;
  if not found then raise exception 'Cette invitation n''est plus valable. Demandez-en une nouvelle à votre administrateur.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.organisation_membres where organisation_id = i.organisation_id and user_id = v_moi) then
    raise exception 'Vous faites déjà partie de cette équipe.' using errcode = 'P0001';
  end if;
  -- Un compte qui a déjà servi (états des lieux, crédits, collègues) ne se fond pas dans une équipe : rien ne doit se perdre.
  for v_ancien in select organisation_id from public.organisation_membres where user_id = v_moi loop
    if exists (select 1 from public.edl where organisation_id = v_ancien) or exists (select 1 from public.credit_lots where organisation_id = v_ancien)
       or exists (select 1 from public.organisation_membres where organisation_id = v_ancien and user_id <> v_moi) then
      raise exception 'Ce compte a déjà servi. Créez un compte avec une autre adresse e-mail pour rejoindre l''équipe.' using errcode = 'P0001';
    end if;
  end loop;
  delete from public.organisations where id in (select organisation_id from public.organisation_membres where user_id = v_moi);
  insert into public.organisation_membres (organisation_id, user_id, role, droits) values (i.organisation_id, v_moi, 'agent', i.droits);
  update public.organisation_invitations set utilisee_le = now(), utilisee_par = v_moi where id = i.id;
  return i.organisation_id;
end $$;

/** L'équipe, pour son administrateur. */
create function public.equipe_membres() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.organisation_membres where user_id = (select auth.uid()) and role in ('proprietaire', 'admin') limit 1;
  if v_org is null then raise exception 'Réservé à l''administrateur du compte.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'email', u.email, 'nom', btrim(coalesce(p.prenom, '') || ' ' || coalesce(p.nom, '')), 'role', m.role, 'droits', m.droits, 'depuis', m.created_at,
      'edl', (select count(*) from public.edl e where e.organisation_id = v_org and e.realise_par = m.user_id)) order by (m.role = 'proprietaire') desc, m.created_at)
    from public.organisation_membres m join auth.users u on u.id = m.user_id left join public.profils p on p.id = m.user_id where m.organisation_id = v_org), '[]'::jsonb);
end $$;

/** Régler les droits d'un collaborateur, ou le nommer administrateur. Le titulaire ne se modifie pas. */
create function public.equipe_regler(p_membre uuid, p_droits jsonb, p_admin boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.organisation_membres where user_id = (select auth.uid()) and role in ('proprietaire', 'admin') limit 1;
  if v_org is null then raise exception 'Réservé à l''administrateur du compte.' using errcode = '42501'; end if;
  update public.organisation_membres set droits = private.droits_propres(p_droits), role = case when p_admin is null then role when p_admin then 'admin' else 'agent' end
  where organisation_id = v_org and user_id = p_membre and role <> 'proprietaire' and user_id <> (select auth.uid());
  if not found then raise exception 'Ce membre ne peut pas être modifié.' using errcode = 'P0001'; end if;
end $$;

/** Retirer un collaborateur. Ses états des lieux restent à l'agence ; il retrouve un compte personnel vide. */
create function public.equipe_retirer(p_membre uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_nouvelle uuid;
begin
  select organisation_id into v_org from public.organisation_membres where user_id = (select auth.uid()) and role in ('proprietaire', 'admin') limit 1;
  if v_org is null then raise exception 'Réservé à l''administrateur du compte.' using errcode = '42501'; end if;
  delete from public.organisation_membres where organisation_id = v_org and user_id = p_membre and role <> 'proprietaire' and user_id <> (select auth.uid());
  if not found then raise exception 'Ce membre ne peut pas être retiré.' using errcode = 'P0001'; end if;
  insert into public.organisations (type, nom) select 'particulier', coalesce(nullif(btrim(coalesce(p.prenom, '') || ' ' || coalesce(p.nom, '')), ''), 'Mon compte') from public.profils p where p.id = p_membre returning id into v_nouvelle;
  if v_nouvelle is null then insert into public.organisations (type, nom) values ('particulier', 'Mon compte') returning id into v_nouvelle; end if;
  insert into public.organisation_membres (organisation_id, user_id, role) values (v_nouvelle, p_membre, 'proprietaire');
end $$;

revoke all on function public.equipe_inviter(text, text, jsonb), public.equipe_invitation(text), public.equipe_rejoindre(text), public.equipe_membres(), public.equipe_regler(uuid, jsonb, boolean), public.equipe_retirer(uuid) from public, anon, authenticated;
grant execute on function public.equipe_inviter(text, text, jsonb), public.equipe_rejoindre(text), public.equipe_membres(), public.equipe_regler(uuid, jsonb, boolean), public.equipe_retirer(uuid) to authenticated;
grant execute on function public.equipe_invitation(text) to anon, authenticated;

commit;
