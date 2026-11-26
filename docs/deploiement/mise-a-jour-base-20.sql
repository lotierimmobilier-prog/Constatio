begin;
-- =============================================================================
-- Constatio — 20 : envoi des e-mails (messagerie du domaine, par SMTP)
-- -----------------------------------------------------------------------------
--   * à la signature : chaque partie qui a une adresse reçoit le lien de son exemplaire signé
--     (et, pour le locataire d'une entrée, le rappel de ses dix jours pour émettre des réserves) ;
--   * une réserve déposée : la personne qui a réalisé l'état des lieux est prévenue ;
--   * une réserve acceptée ou refusée : le locataire est prévenu.
-- La base ne fait qu'inscrire le message à envoyer dans une file ; la fonction « courriel »
-- l'expédie (aussitôt, puis toutes les dix minutes pour ce qui n'est pas parti).
-- Un envoi en échec ne bloque jamais une signature ni une réserve.
-- En mode test, rien ne part. Le mot de passe de la boîte se saisit dans l'administration.
-- =============================================================================
alter table private.cles_service drop constraint cles_service_nom_check;
alter table private.cles_service add constraint cles_service_nom_check
  check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'releve_secret',
                 'smtp_utilisateur', 'smtp_mot_de_passe', 'smtp_hote'));

create or replace function public.admin_definir_cle(p_nom text, p_valeur text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_valeur, '')), '');
  v_lisible boolean := p_nom in ('docuseal_url', 'smtp_utilisateur', 'smtp_hote');
begin
  perform private.exiger_admin(true);
  if p_nom not in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'smtp_utilisateur', 'smtp_mot_de_passe', 'smtp_hote') then
    raise exception 'Clé inconnue.' using errcode = 'P0001';
  end if;
  if v is null then
    delete from private.cles_service where nom = p_nom;
    perform private.journal_admin('cle.effacee', p_nom);
    return;
  end if;
  if (p_nom = 'stripe_cle_test'   and v !~ '^(sk|rk)_test_[A-Za-z0-9]{16,}$')
  or (p_nom = 'stripe_cle_reelle' and v !~ '^(sk|rk)_live_[A-Za-z0-9]{16,}$')
  or (p_nom like 'stripe_webhook_%' and v !~ '^whsec_[A-Za-z0-9]{16,}$')
  or (p_nom = 'docuseal_cle' and v !~ '^[A-Za-z0-9_-]{20,}$')
  or (p_nom = 'docuseal_url' and v !~ '^https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9/_-]*)?$')
  or (p_nom = 'smtp_utilisateur' and v !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
  or (p_nom = 'smtp_hote' and v !~ '^[A-Za-z0-9.-]+(:[0-9]{2,5})?$')
  or (p_nom = 'smtp_mot_de_passe' and (char_length(v) < 8 or v ~ '[\r\n]')) then
    raise exception 'Cette valeur n''a pas la forme attendue pour cette clé.' using errcode = 'P0001';
  end if;
  insert into private.cles_service (nom, valeur, par) values (p_nom, v, (select auth.uid()))
  on conflict (nom) do update set valeur = excluded.valeur, updated_at = now(), par = excluded.par;
  -- Une adresse n'est pas un secret : elle se relit en entier ; une clé ou un mot de passe, jamais (pas même sa fin pour un mot de passe).
  perform private.journal_admin('cle.enregistree', p_nom, jsonb_build_object('fin', case when v_lisible then v when p_nom = 'smtp_mot_de_passe' then '••••' else right(v, 4) end));
end $$;

create or replace function public.admin_cles() returns table (nom text, fin text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  return query select c.nom, case when c.nom in ('docuseal_url', 'smtp_utilisateur', 'smtp_hote') then c.valeur when c.nom = 'smtp_mot_de_passe' then '••••' else right(c.valeur, 4) end, c.updated_at
  from private.cles_service c where c.nom <> 'releve_secret' order by c.nom;
end $$;

/** Pour la fonction serveur : les réglages de la boîte d'envoi. */
create function public.cles_courriel() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode_test', coalesce((select (valeur)::text <> 'false' from public.parametres where cle = 'mode_test'), true),
    'hote', coalesce((select valeur from private.cles_service where nom = 'smtp_hote'), 'smtp.hostinger.com:465'),
    'utilisateur', (select valeur from private.cles_service where nom = 'smtp_utilisateur'),
    'mot_de_passe', (select valeur from private.cles_service where nom = 'smtp_mot_de_passe'))
$$;
revoke all on function public.cles_courriel() from public, anon, authenticated;
grant execute on function public.cles_courriel() to service_role;

-- File des messages à envoyer. Lue et tenue par la seule fonction serveur.
create table public.courriels (
  id            uuid primary key default gen_random_uuid(),
  edl_id        uuid not null references public.edl (id) on delete cascade,
  type          text not null check (type in ('document_signe', 'reserve_deposee', 'reserve_repondue')),
  reference     uuid,                      -- la réserve concernée
  cree_le       timestamptz not null default now(),
  envoye_le     timestamptz,               -- traité (parti, ou sans destinataire, ou retenu en mode test)
  tentatives    smallint not null default 0,
  destinataires smallint,
  note          text
);
create index courriels_attente_idx on public.courriels (cree_le) where envoye_le is null;
alter table public.courriels enable row level security;
revoke all on public.courriels from public, anon, authenticated;
grant select, update on public.courriels to service_role;
grant select, insert on public.edl_jetons to service_role;

/** Demande à la fonction « courriel » d'expédier la file. Sans adresse des fonctions ou sans pg_net : rien (la tâche planifiée repassera). */
create function private.expedier_courriels() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text := (select valeur #>> '{}' from public.parametres where cle = 'url_fonctions');
begin
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

create function private.courriel_a_envoyer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'edl' then
    insert into public.courriels (edl_id, type) values (new.id, 'document_signe');
  elsif tg_op = 'INSERT' then
    insert into public.courriels (edl_id, type, reference) values (new.edl_id, 'reserve_deposee', new.id);
  else
    insert into public.courriels (edl_id, type, reference) values (new.edl_id, 'reserve_repondue', new.id);
  end if;
  perform private.expedier_courriels();
  return null;
end $$;
create trigger edl_courriel_signe after update of statut on public.edl
  for each row when (new.statut = 'signe' and old.statut is distinct from new.statut) execute function private.courriel_a_envoyer();
create trigger edl_complements_courriel_depot after insert on public.edl_complements
  for each row when (new.type = 'general') execute function private.courriel_a_envoyer();
create trigger edl_complements_courriel_reponse after update of statut on public.edl_complements
  for each row when (new.type = 'general' and new.statut <> 'demande' and old.statut is distinct from new.statut) execute function private.courriel_a_envoyer();

-- Le lien du document n'annule plus les précédents : celui reçu par e-mail reste valable
-- quand le bailleur en crée un autre à la main. Chacun expire au bout d'un an.
create or replace function public.reserves_lien(p_edl uuid, p_partie uuid, p_jeton_hash text) returns timestamptz
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
  if (select count(*) from public.edl_jetons where partie_id = p_partie and usage = 'complement') >= 20 then
    raise exception 'Trop de liens ont été créés pour cette personne : réutilisez le dernier.' using errcode = 'P0001';
  end if;
  if e.type = 'entrant' and v_role = 'locataire' and now() <= e.signe_le + interval '10 days' then v_depot := e.signe_le + interval '10 days'; end if;
  insert into public.edl_jetons (edl_id, partie_id, usage, jeton_hash, expire_le, depot_jusqu_au)
    values (p_edl, p_partie, 'complement', p_jeton_hash, now() + interval '1 year', v_depot);
  insert into public.edl_journal (edl_id, evenement, acteur_id, details) values (p_edl, 'reserves_lien_cree', (select auth.uid()), jsonb_build_object('partie', p_partie, 'depot_jusqu_au', v_depot));
  return v_depot;
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    perform cron.schedule('constatio-courriels', '*/10 * * * *', 'select private.expedier_courriels()');
  else
    raise notice 'pg_cron ou pg_net absents : file des e-mails non planifiée.';
  end if;
end $$;
commit;
