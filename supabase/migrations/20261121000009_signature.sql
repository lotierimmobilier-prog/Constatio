-- =============================================================================
-- Signature électronique des parties.
--   * sur place : sur l'appareil de la personne qui réalise l'état des lieux ;
--   * à distance : par un lien personnel à usage unique (seule l'empreinte du
--     jeton est conservée).
-- Chaque signature porte sur l'empreinte SHA-256 du document définitif. Quand
-- toutes les parties attendues ont signé, le serveur dépose l'exemplaire signé
-- (signatures dans leurs cases + dossier de preuve) et l'état des lieux devient
-- « signé » : plus rien ne s'y modifie.
-- Toutes ces fonctions sont réservées au serveur (rôle de service).
-- Codes d'erreur propres : CS001 = déjà signé, CS002 = lien non valable.
-- =============================================================================
alter table public.edl
  add column pdf_signe_path   text,
  add column pdf_signe_sha256 text;

-- L'exemplaire signé se dépose sur un état des lieux terminé, au moment où il devient signé.
create or replace function private.verrou_edl() returns trigger
language plpgsql set search_path = '' as $$
declare
  libres text[] := array['collab_edl_id', 'signabail_bail_id', 'debut_periode_chauffe', 'updated_at'];
  document text[] := array['pdf_path', 'pdf_sha256', 'genere_le'];
begin
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
  if tg_op = 'UPDATE' and old.statut = 'termine' and new.statut = 'termine'
     and (to_jsonb(new) - libres - document) is distinct from (to_jsonb(old) - libres - document) then
    raise exception 'État des lieux terminé : rouvrez-le pour le corriger.' using errcode = 'P0001';
  end if;
  -- L'exemplaire signé n'existe que sur un état des lieux signé.
  if tg_op = 'UPDATE' and new.statut <> 'signe' and (new.pdf_signe_path is not null or new.pdf_signe_sha256 is not null) then
    raise exception 'L''exemplaire signé ne se dépose qu''à la clôture des signatures.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Une signature. Rend le nombre de signatures encore attendues.
create function public.edl_signer(p_edl uuid, p_partie uuid, p_mode text, p_image text, p_ip inet, p_appareil text,
                                  p_acteur uuid default null, p_jeton_hash text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  p public.edl_parties;
  v_jeton uuid;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or e.statut <> 'termine' or e.pdf_sha256 is null then
    raise exception 'Le document définitif doit être généré avant de signer.' using errcode = 'P0001';
  end if;
  select * into p from public.edl_parties where id = p_partie and edl_id = p_edl;
  if not found or not p.doit_signer then
    raise exception 'Cette personne n''a pas à signer cet état des lieux.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl_signatures where partie_id = p_partie) then
    raise exception 'Cette personne a déjà signé.' using errcode = 'CS001';
  end if;
  if p_mode = 'a_distance' then
    select id into v_jeton from public.edl_jetons
    where jeton_hash = p_jeton_hash and edl_id = p_edl and partie_id = p_partie and usage = 'signature'
      and utilise_le is null and expire_le > now() for update;
    if v_jeton is null then
      raise exception 'Ce lien de signature n''est plus valable.' using errcode = 'CS002';
    end if;
    update public.edl_jetons set utilise_le = now() where id = v_jeton;
  end if;
  insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256, image_path, ip, user_agent)
  values (p_edl, p_partie, p_mode, e.pdf_sha256, p_image, p_ip, left(p_appareil, 400));
  insert into public.edl_journal (edl_id, evenement, acteur_id, acteur_nom, details)
  values (p_edl, 'signature', p_acteur, trim(p.prenom || ' ' || p.nom),
          jsonb_build_object('partie', p_partie, 'role', p.role, 'mode', p_mode, 'pdf_sha256', e.pdf_sha256, 'ip', host(p_ip)));
  return (select count(*)::integer from public.edl_parties x
          where x.edl_id = p_edl and x.doit_signer
            and not exists (select 1 from public.edl_signatures s where s.partie_id = x.id and s.pdf_sha256 = e.pdf_sha256));
end $$;

-- Clôture : dépôt de l'exemplaire signé et passage à « signé », d'un seul tenant.
create function public.edl_cloturer_signatures(p_edl uuid, p_chemin text, p_sha256 text)
returns public.edl language plpgsql security definer set search_path = '' as $$
declare e public.edl;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or e.statut <> 'termine' or e.pdf_sha256 is null then
    raise exception 'L''état des lieux doit être terminé et son PDF généré.' using errcode = 'P0001';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_chemin not like e.organisation_id || '/' || e.id || '/pdf/%' then
    raise exception 'Document refusé.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl_parties p where p.edl_id = p_edl and p.doit_signer
             and not exists (select 1 from public.edl_signatures s where s.partie_id = p.id and s.pdf_sha256 = e.pdf_sha256)) then
    raise exception 'Toutes les parties n''ont pas signé ce document.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.edl_signatures where edl_id = p_edl) then
    raise exception 'Aucune signature.' using errcode = 'P0001';
  end if;
  update public.edl set statut = 'signe', signe_le = now(), pdf_signe_path = p_chemin, pdf_signe_sha256 = p_sha256
  where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, details)
  values (p_edl, 'signe', jsonb_build_object('pdf_sha256', e.pdf_sha256, 'pdf_signe_sha256', p_sha256));
  return e;
end $$;

-- Lien de signature à distance : un seul lien valable à la fois par personne.
create function public.edl_creer_jeton_signature(p_edl uuid, p_partie uuid, p_jeton_hash text, p_acteur uuid, p_jours integer default 7)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  v_fin timestamptz := now() + make_interval(days => least(greatest(p_jours, 1), 30));
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or e.statut <> 'termine' or e.pdf_sha256 is null then
    raise exception 'Le document définitif doit être généré avant d''envoyer un lien.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.edl_parties where id = p_partie and edl_id = p_edl and doit_signer) then
    raise exception 'Cette personne n''a pas à signer cet état des lieux.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl_signatures where partie_id = p_partie) then
    raise exception 'Cette personne a déjà signé.' using errcode = 'CS001';
  end if;
  delete from public.edl_jetons where partie_id = p_partie and usage = 'signature' and utilise_le is null;
  insert into public.edl_jetons (edl_id, partie_id, usage, jeton_hash, expire_le) values (p_edl, p_partie, 'signature', p_jeton_hash, v_fin);
  insert into public.edl_journal (edl_id, evenement, acteur_id, details)
  values (p_edl, 'lien_cree', p_acteur, jsonb_build_object('partie', p_partie, 'expire_le', v_fin));
  return v_fin;
end $$;

-- Rouvrir retire aussi les liens en attente : ils portaient sur un document qui n'existe plus.
create or replace function public.edl_rouvrir(p_edl uuid) returns public.edl
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
  delete from public.edl_jetons where edl_id = p_edl and usage = 'signature';
  update public.edl set statut = 'brouillon', pdf_path = null, pdf_sha256 = null, genere_le = null
  where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, acteur_id)
  values (p_edl, 'rouvert', (select auth.uid()));
  return e;
end $$;

-- L'ancienne clôture sans exemplaire signé n'a plus cours.
drop function public.edl_marquer_signe(uuid);

do $$
declare f text;
begin
  foreach f in array array['edl_signer(uuid, uuid, text, text, inet, text, uuid, text)', 'edl_cloturer_signatures(uuid, text, text)',
                           'edl_creer_jeton_signature(uuid, uuid, text, uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
