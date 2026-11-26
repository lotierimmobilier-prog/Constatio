-- Mise à jour de la base Constatio : migration 18 (réserves du locataire sous dix jours ; mandataires et signatures).
-- À coller dans Supabase > SQL Editor du projet CONSTATIO, puis « Run ». Une seule fois.
-- À passer APRÈS la migration 17.
begin;

-- =============================================================================
-- Constatio — 18 : réserves du locataire après l'état des lieux d'entrée
-- -----------------------------------------------------------------------------
-- Loi n° 89-462 du 6 juillet 1989, art. 3-2 : le locataire peut demander au
-- bailleur de compléter l'état des lieux d'entrée dans les dix jours de son
-- établissement. (Référence à faire vérifier par un juriste.)
--   * le bailleur remet au locataire un lien personnel, valable jusqu'au dixième jour ;
--   * le locataire y dépose ses réserves, sans compte ;
--   * le bailleur accepte ou refuse chacune, avec sa réponse ;
--   * l'ensemble s'imprime en annexe de l'état des lieux (le document signé, lui, ne change pas).
-- Le délai est tenu par la base (déclencheur de la table edl_complements, migration 2).
-- Tout passe par des fonctions de la base : aucune fonction serveur à déployer.
-- =============================================================================

/** Le bailleur crée le lien de réserves d'un locataire. Seule l'empreinte du jeton est gardée. */
create function public.reserves_lien(p_edl uuid, p_partie uuid, p_jeton_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  v_fin timestamptz;
begin
  select * into e from public.edl where id = p_edl;
  if not found or not private.edl_lisible(p_edl) or not private.est_membre(e.organisation_id) then
    raise exception 'État des lieux introuvable.' using errcode = '42501';
  end if;
  if e.type <> 'entrant' or e.statut <> 'signe' then
    raise exception 'Les réserves concernent un état des lieux d''entrée signé.' using errcode = 'P0001';
  end if;
  v_fin := e.signe_le + interval '10 days';
  if now() > v_fin then raise exception 'Le délai de dix jours est dépassé.' using errcode = 'P0001'; end if;
  if p_jeton_hash !~ '^[0-9a-f]{64}$' or not exists (select 1 from public.edl_parties where id = p_partie and edl_id = p_edl and role = 'locataire') then
    raise exception 'Ce lien ne peut être créé que pour un locataire de cet état des lieux.' using errcode = 'P0001';
  end if;
  delete from public.edl_jetons where partie_id = p_partie and usage = 'complement';
  insert into public.edl_jetons (edl_id, partie_id, usage, jeton_hash, expire_le) values (p_edl, p_partie, 'complement', p_jeton_hash, v_fin);
  insert into public.edl_journal (edl_id, evenement, acteur_id, details) values (p_edl, 'reserves_lien_cree', (select auth.uid()), jsonb_build_object('partie', p_partie, 'expire_le', v_fin));
  return v_fin;
end $$;

create function private.jeton_reserves(p_jeton text) returns public.edl_jetons
language sql stable security definer set search_path = '' as $$
  select j from public.edl_jetons j
  where j.jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex') and j.usage = 'complement'
$$;

/** Ce que voit le locataire en ouvrant son lien : de quel état des lieux il s'agit, jusqu'à quand, et ses réserves déjà déposées. */
create function public.reserves_consulter(p_jeton text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'adresse', l.adresse || ', ' || l.code_postal || ' ' || l.ville,
    'date_edl', e.date_edl, 'signe_le', e.signe_le, 'limite', j.expire_le, 'ouvert', now() <= j.expire_le,
    'locataire', btrim(coalesce(p.civilite || ' ', '') || coalesce(p.prenom || ' ', '') || p.nom),
    'reserves', coalesce((select jsonb_agg(jsonb_build_object('texte', c.texte, 'statut', c.statut, 'reponse', c.reponse, 'depose_le', c.created_at, 'repondu_le', c.repondu_le) order by c.created_at)
                          from public.edl_complements c where c.edl_id = e.id and c.partie_id = p.id), '[]'::jsonb))
  from private.jeton_reserves(p_jeton) j
  join public.edl e on e.id = j.edl_id join public.logements l on l.id = e.logement_id join public.edl_parties p on p.id = j.partie_id
$$;

/** Le locataire dépose une réserve. Refusé passé le dixième jour. */
create function public.reserves_deposer(p_jeton text, p_texte text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.edl_jetons := private.jeton_reserves(p_jeton);
  v text := btrim(coalesce(p_texte, ''));
begin
  if j.id is null then raise exception 'Ce lien n''est pas valable.' using errcode = 'P0001'; end if;
  if now() > j.expire_le then raise exception 'Le délai de dix jours pour compléter l''état des lieux est dépassé.' using errcode = 'P0001'; end if;
  if char_length(v) < 5 or char_length(v) > 2000 then raise exception 'Décrivez votre réserve en quelques mots (2 000 caractères au plus).' using errcode = 'P0001'; end if;
  if (select count(*) from public.edl_complements where edl_id = j.edl_id and partie_id = j.partie_id) >= 30 then
    raise exception 'Vous avez déjà déposé trente réserves : contactez directement votre bailleur.' using errcode = 'P0001';
  end if;
  insert into public.edl_complements (edl_id, type, partie_id, texte) values (j.edl_id, 'general', j.partie_id, v);
  insert into public.edl_journal (edl_id, evenement, details) values (j.edl_id, 'reserve_deposee', jsonb_build_object('partie', j.partie_id));
end $$;

/** Le bailleur accepte ou refuse une réserve, avec sa réponse. La décision est datée et journalisée. */
create function public.reserves_repondre(p_reserve uuid, p_accepte boolean, p_reponse text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.edl_complements;
begin
  select * into c from public.edl_complements where id = p_reserve for update;
  if not found or not private.edl_de_mon_organisation(c.edl_id) or not private.edl_lisible(c.edl_id) then
    raise exception 'Réserve introuvable.' using errcode = '42501';
  end if;
  update public.edl_complements set statut = case when p_accepte then 'accepte' else 'refuse' end, reponse = nullif(btrim(coalesce(p_reponse, '')), ''), repondu_le = now() where id = p_reserve;
  insert into public.edl_journal (edl_id, evenement, acteur_id, details) values (c.edl_id, 'reserve_repondue', (select auth.uid()), jsonb_build_object('reserve', p_reserve, 'acceptee', p_accepte));
end $$;

revoke all on function public.reserves_lien(uuid, uuid, text), public.reserves_consulter(text), public.reserves_deposer(text, text), public.reserves_repondre(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.reserves_lien(uuid, uuid, text), public.reserves_repondre(uuid, boolean, text) to authenticated;
grant execute on function public.reserves_consulter(text), public.reserves_deposer(text, text) to anon, authenticated;

-- Représentation : la partie qu'un mandataire représente ne signe pas ; c'est lui qui signe pour elle.
-- Sans mandataire, elle signe de nouveau elle-même. (Mêmes règles que l'écran des parties.)
create function private.representation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.represente_id is not null then
    update public.edl_parties set doit_signer = false where id = new.represente_id and doit_signer;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.represente_id is not null and (tg_op = 'DELETE' or old.represente_id is distinct from new.represente_id)
     and not exists (select 1 from public.edl_parties m where m.represente_id = old.represente_id and m.id <> old.id)
     and exists (select 1 from public.edl where id = old.edl_id and statut = 'brouillon') then
    update public.edl_parties set doit_signer = true where id = old.represente_id;
  end if;
  return null;
end $$;
create trigger edl_parties_representation after insert or update of represente_id or delete on public.edl_parties
  for each row execute function private.representation();
-- Rattrapage des états des lieux en cours.
update public.edl_parties p set doit_signer = false
where doit_signer and exists (select 1 from public.edl_parties m where m.represente_id = p.id)
  and exists (select 1 from public.edl e where e.id = p.edl_id and e.statut = 'brouillon');

commit;
