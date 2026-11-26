-- =============================================================================
-- Constatio — 16 : relève automatique des signatures électroniques
-- -----------------------------------------------------------------------------
-- Toutes les dix minutes, la base demande à la fonction « signature » de relever
-- les demandes DocuSeal en cours : un document signé par tous est rapatrié et son
-- état des lieux clos sans que personne ait à cliquer.
--   * L'appel porte un secret tiré au hasard à l'installation, connu de la base seule.
--   * L'adresse des fonctions se règle une fois, au déploiement :
--       update public.parametres set valeur = '"https://<projet>.supabase.co/functions/v1"' where cle = 'url_fonctions';
--     Tant qu'elle est vide, la tâche ne fait rien.
--   * Sans les extensions pg_cron et pg_net (poste de développement), rien n'est planifié ;
--     l'application relève de toute façon à l'ouverture du document.
-- =============================================================================
alter table private.cles_service drop constraint cles_service_nom_check;
alter table private.cles_service add constraint cles_service_nom_check
  check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'releve_secret'));
insert into private.cles_service (nom, valeur) values ('releve_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
on conflict (nom) do nothing;
insert into public.parametres (cle, valeur) values ('url_fonctions', 'null') on conflict (cle) do nothing;

/** Pour la fonction serveur : le secret que doit porter l'appel de la tâche planifiée. */
create function public.cle_releve() returns text
language sql stable security definer set search_path = '' as $$
  select valeur from private.cles_service where nom = 'releve_secret'
$$;
revoke all on function public.cle_releve() from public, anon, authenticated;
grant execute on function public.cle_releve() to service_role;

-- L'écran d'administration ne liste pas ce secret technique.
create or replace function public.admin_cles() returns table (nom text, fin text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  return query select c.nom, case when c.nom = 'docuseal_url' then c.valeur else right(c.valeur, 4) end, c.updated_at
  from private.cles_service c where c.nom <> 'releve_secret' order by c.nom;
end $$;

create function private.relever_signatures() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select valeur #>> '{}' from public.parametres where cle = 'url_fonctions');
begin
  if v_url is null or v_url = '' then return; end if;
  -- Rien à relever : pas d'appel.
  if not exists (select 1 from public.edl_signature_electronique where statut = 'en_signature' and demande_id is not null and demande_id not like 'test-%') then return; end if;
  perform net.http_post(
    url := v_url || '/signature',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-releve', (select valeur from private.cles_service where nom = 'releve_secret')),
    body := '{"action":"electronique_relever_tout"}'::jsonb);
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('constatio-releve-signatures', '*/10 * * * *', 'select private.relever_signatures()');
  else
    raise notice 'pg_cron ou pg_net absents : relève automatique non planifiée (elle se fait à l''ouverture du document).';
  end if;
end $$;
