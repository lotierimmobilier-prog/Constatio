begin;
-- =============================================================================
-- Constatio — 19 : réserves par pièce et avec photos ; lien du document signé
-- -----------------------------------------------------------------------------
--   * une réserve désigne la pièce concernée et peut porter jusqu'à six photos ;
--   * le lien personnel devient le « lien du document » : chaque partie y retrouve
--     l'état des lieux signé et les réserves, pendant un an ; le bailleur ou son
--     mandataire peut le renvoyer à tout moment (un nouveau lien remplace l'ancien) ;
--   * seul un locataire, sur un état des lieux d'entrée, peut déposer — et pendant
--     dix jours seulement (loi du 6 juillet 1989, art. 3-2 ; à faire vérifier par un juriste).
-- =============================================================================

alter table public.edl_complements add column piece_id uuid references public.edl_pieces (id) on delete set null;
-- Jusqu'à quand ce lien permet de déposer des réserves (vide : il ne sert qu'à consulter).
alter table public.edl_jetons add column depot_jusqu_au timestamptz;
update public.edl_jetons set depot_jusqu_au = expire_le where usage = 'complement';

drop function public.reserves_lien(uuid, uuid, text);
drop function public.reserves_deposer(text, text);

/** Crée le lien du document d'une partie. Rend la date limite de dépôt des réserves, s'il y en a une. */
create function public.reserves_lien(p_edl uuid, p_partie uuid, p_jeton_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  v_role text;
  v_depot timestamptz;
begin
  select * into e from public.edl where id = p_edl;
  if not found or not private.edl_lisible(p_edl) or not private.est_membre(e.organisation_id) then
    raise exception 'État des lieux introuvable.' using errcode = '42501';
  end if;
  if e.statut <> 'signe' then raise exception 'Le lien du document se crée une fois l''état des lieux signé.' using errcode = 'P0001'; end if;
  select role::text into v_role from public.edl_parties where id = p_partie and edl_id = p_edl;
  if v_role is null or p_jeton_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Ce lien ne peut être créé que pour une partie de cet état des lieux.' using errcode = 'P0001';
  end if;
  if e.type = 'entrant' and v_role = 'locataire' and now() <= e.signe_le + interval '10 days' then v_depot := e.signe_le + interval '10 days'; end if;
  delete from public.edl_jetons where partie_id = p_partie and usage = 'complement';
  insert into public.edl_jetons (edl_id, partie_id, usage, jeton_hash, expire_le, depot_jusqu_au)
    values (p_edl, p_partie, 'complement', p_jeton_hash, now() + interval '1 year', v_depot);
  insert into public.edl_journal (edl_id, evenement, acteur_id, details) values (p_edl, 'reserves_lien_cree', (select auth.uid()), jsonb_build_object('partie', p_partie, 'depot_jusqu_au', v_depot));
  return v_depot;
end $$;

/** Ce que voit la partie en ouvrant son lien. Un lien expiré ne rend rien. */
create or replace function public.reserves_consulter(p_jeton text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'adresse', l.adresse || ', ' || l.code_postal || ' ' || l.ville,
    'type', e.type, 'date_edl', e.date_edl, 'signe_le', e.signe_le, 'empreinte', e.pdf_signe_sha256,
    'limite', coalesce(j.depot_jusqu_au, case when e.type = 'entrant' then e.signe_le + interval '10 days' end),
    'ouvert', j.depot_jusqu_au is not null and now() <= j.depot_jusqu_au,
    'role', p.role,
    'locataire', btrim(coalesce(p.civilite || ' ', '') || coalesce(p.prenom || ' ', '') || p.nom),
    'dossier', e.organisation_id || '/' || e.id || '/reserves/' || j.jeton_hash,
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('id', pi.id, 'nom', pi.nom) order by pi.ordre, pi.nom) from public.edl_pieces pi where pi.edl_id = e.id), '[]'::jsonb),
    'reserves', coalesce((select jsonb_agg(jsonb_build_object(
        'texte', c.texte, 'statut', c.statut, 'reponse', c.reponse, 'depose_le', c.created_at, 'repondu_le', c.repondu_le,
        'piece', (select pi.nom from public.edl_pieces pi where pi.id = c.piece_id), 'photos', c.photo_paths,
        'de', (select btrim(coalesce(q.civilite || ' ', '') || coalesce(q.prenom || ' ', '') || q.nom) from public.edl_parties q where q.id = c.partie_id)) order by c.created_at)
      from public.edl_complements c where c.edl_id = e.id and c.type = 'general'), '[]'::jsonb))
  from private.jeton_reserves(p_jeton) j
  join public.edl e on e.id = j.edl_id join public.logements l on l.id = e.logement_id join public.edl_parties p on p.id = j.partie_id
  where now() <= j.expire_le and e.statut = 'signe'
$$;

/** Le locataire dépose une réserve : la pièce, le constat, et ses photos déjà envoyées dans son dossier. */
create function public.reserves_deposer(p_jeton text, p_texte text, p_piece uuid default null, p_photos text[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.edl_jetons := private.jeton_reserves(p_jeton);
  v text := btrim(coalesce(p_texte, ''));
  v_org uuid;
  v_photos text[] := coalesce(p_photos, '{}');
  v_chemin text;
begin
  if j.id is null or now() > j.expire_le then raise exception 'Ce lien n''est pas valable.' using errcode = 'P0001'; end if;
  if j.depot_jusqu_au is null then raise exception 'Ce lien permet de consulter le document, pas de déposer des réserves.' using errcode = 'P0001'; end if;
  if now() > j.depot_jusqu_au then raise exception 'Le délai de dix jours pour compléter l''état des lieux est dépassé.' using errcode = 'P0001'; end if;
  if char_length(v) < 5 or char_length(v) > 2000 then raise exception 'Décrivez votre réserve en quelques mots (2 000 caractères au plus).' using errcode = 'P0001'; end if;
  if (select count(*) from public.edl_complements where edl_id = j.edl_id and partie_id = j.partie_id) >= 30 then
    raise exception 'Vous avez déjà déposé trente réserves : contactez directement votre bailleur.' using errcode = 'P0001';
  end if;
  if p_piece is not null and not exists (select 1 from public.edl_pieces where id = p_piece and edl_id = j.edl_id) then
    raise exception 'Cette pièce ne figure pas dans l''état des lieux.' using errcode = 'P0001';
  end if;
  if cardinality(v_photos) > 6 then raise exception 'Six photos au plus par réserve.' using errcode = 'P0001'; end if;
  select organisation_id into v_org from public.edl where id = j.edl_id;
  foreach v_chemin in array v_photos loop
    -- Seules les photos que ce lien a lui-même envoyées, et qui existent bien.
    if v_chemin !~ ('^' || v_org || '/' || j.edl_id || '/reserves/' || j.jeton_hash || '/[0-9a-f-]{36}\.jpg$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'edl' and o.name = v_chemin) then
      raise exception 'Une photo n''a pas été reçue. Retirez-la puis ajoutez-la de nouveau.' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.edl_complements (edl_id, type, partie_id, piece_id, texte, photo_paths) values (j.edl_id, 'general', j.partie_id, p_piece, v, v_photos);
  insert into public.edl_journal (edl_id, evenement, details) values (j.edl_id, 'reserve_deposee', jsonb_build_object('partie', j.partie_id, 'piece', p_piece, 'photos', cardinality(v_photos)));
end $$;

revoke all on function public.reserves_lien(uuid, uuid, text), public.reserves_deposer(text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reserves_lien(uuid, uuid, text) to authenticated;
grant execute on function public.reserves_deposer(text, text, uuid, text[]) to anon, authenticated;

-- Photos des réserves : le locataire, sans compte, n'écrit que dans le dossier de son propre lien,
-- tant que le dépôt est ouvert, et quarante fichiers au plus. Il ne peut ni lire ni remplacer.
create function private.depot_reserve_admis(p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl_jetons j join public.edl e on e.id = j.edl_id
    where j.jeton_hash = split_part(p_nom, '/', 4) and j.usage = 'complement' and j.depot_jusqu_au is not null and now() <= j.depot_jusqu_au and now() <= j.expire_le
      and p_nom ~ ('^' || e.organisation_id || '/' || e.id || '/reserves/' || j.jeton_hash || '/[0-9a-f-]{36}\.jpg$')
      and (select count(*) from storage.objects o where o.bucket_id = 'edl' and o.name like e.organisation_id || '/' || e.id || '/reserves/' || j.jeton_hash || '/%') < 40)
$$;
revoke all on function private.depot_reserve_admis(text) from public;
grant execute on function private.depot_reserve_admis(text) to anon, authenticated;
create policy edl_reserves_depot on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'edl' and (storage.foldername(name))[3] = 'reserves' and private.depot_reserve_admis(name));
commit;
