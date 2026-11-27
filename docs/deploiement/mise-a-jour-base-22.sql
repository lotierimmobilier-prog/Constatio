begin;
-- =============================================================================
-- Constatio — 22 : un e-mail à chaque partie, à chaque étape de l'état des lieux finalisé
-- -----------------------------------------------------------------------------
-- Bailleur, locataire et mandataires reçoivent chacun un texte adapté :
--   après les signatures ; à chaque réserve déposée ; à chaque réserve acceptée ou refusée ;
--   et, nouveau, à la fin du délai de dix jours (bilan des réserves).
-- Ce dernier message est inscrit par la tâche planifiée, une seule fois par état des lieux,
-- dans les trois jours qui suivent la fin du délai (jamais pour un état des lieux ancien).
-- =============================================================================
alter table public.courriels drop constraint courriels_type_check;
alter table public.courriels add constraint courriels_type_check
  check (type in ('document_signe', 'reserve_deposee', 'reserve_repondue', 'delai_reserves_clos'));
create unique index courriels_cloture_unique on public.courriels (edl_id) where type = 'delai_reserves_clos';

create or replace function private.expedier_courriels() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text := (select valeur #>> '{}' from public.parametres where cle = 'url_fonctions');
begin
  -- Fin du délai de dix jours : un message par état des lieux d'entrée signé.
  insert into public.courriels (edl_id, type)
    select e.id, 'delai_reserves_clos' from public.edl e
    where e.type = 'entrant' and e.statut = 'signe'
      and e.signe_le + interval '10 days' <= now() and e.signe_le + interval '13 days' > now()
  on conflict do nothing;

  if v_url is null or v_url = '' then return; end if;
  if not exists (select 1 from public.courriels where envoye_le is null and tentatives < 5 and cree_le > now() - interval '7 days') then return; end if;
  perform net.http_post(
    url := v_url || '/courriel',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-releve', (select valeur from private.cles_service where nom = 'releve_secret')),
    body := '{"action":"expedier"}'::jsonb);
exception when others then
  -- Jamais une signature ou une réserve ne doit échouer parce qu'un e-mail ne part pas.
  raise warning 'courriels : expédition non demandée (%)', sqlerrm;
end $$;
commit;
