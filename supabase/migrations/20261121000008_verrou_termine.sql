-- =============================================================================
-- Un état des lieux « terminé » ne se modifie plus.
-- Son PDF a été généré et son empreinte conservée : c'est ce document que les
-- parties vont signer. Tant qu'il n'est pas rouvert (edl_rouvrir, possible
-- seulement si personne n'a signé), rien de ce qu'il décrit ne doit changer —
-- sinon le document signé ne correspondrait plus aux données.
-- Garantie de la base, pas seulement de l'interface.
-- =============================================================================
create or replace function private.edl_modifiable(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl e
    where e.id = p_edl and e.statut = 'brouillon' and private.est_membre(e.organisation_id)
  )
$$;

create or replace function private.verrou_enfant() returns trigger
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
  if v_statut = 'termine' then
    raise exception 'État des lieux terminé : rouvrez-le pour le corriger.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function private.verrou_edl() returns trigger
language plpgsql set search_path = '' as $$
declare
  libres text[] := array['collab_edl_id', 'signabail_bail_id', 'debut_periode_chauffe', 'updated_at'];
  -- Écrits par le serveur une fois le PDF déposé.
  document text[] := array['pdf_path', 'pdf_sha256', 'genere_le'];
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
  -- Terminé et qui le reste : seul le dépôt du document est admis. Le retour en
  -- brouillon (edl_rouvrir) et le passage à « signé » changent le statut et passent.
  if tg_op = 'UPDATE' and old.statut = 'termine' and new.statut = 'termine'
     and (to_jsonb(new) - libres - document) is distinct from (to_jsonb(old) - libres - document) then
    raise exception 'État des lieux terminé : rouvrez-le pour le corriger.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Dépôt du document définitif : réservé au serveur, sur un état des lieux terminé.
create function public.edl_deposer_pdf(p_edl uuid, p_chemin text, p_sha256 text, p_acteur uuid, p_pages integer, p_octets integer)
returns public.edl language plpgsql security definer set search_path = '' as $$
declare e public.edl;
begin
  select * into e from public.edl where id = p_edl for update;
  if not found or e.statut <> 'termine' then
    raise exception 'Le document ne se dépose que sur un état des lieux terminé.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.edl_signatures where edl_id = p_edl) then
    raise exception 'Une partie a déjà signé : le document ne se remplace plus.' using errcode = 'P0001';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_chemin not like e.organisation_id || '/' || e.id || '/pdf/%' then
    raise exception 'Document refusé.' using errcode = 'P0001';
  end if;
  update public.edl set pdf_path = p_chemin, pdf_sha256 = p_sha256, genere_le = now() where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, acteur_id, details)
  values (p_edl, 'pdf_genere', p_acteur, jsonb_build_object('pdf_sha256', p_sha256, 'pages', p_pages, 'octets', p_octets));
  return e;
end $$;
revoke all on function public.edl_deposer_pdf(uuid, text, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.edl_deposer_pdf(uuid, text, text, uuid, integer, integer) to service_role;
