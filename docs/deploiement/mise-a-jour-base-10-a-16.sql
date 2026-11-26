-- Mise à jour de la base Constatio : migrations 10 à 16, dans l'ordre, en une seule fois.
-- À coller dans Supabase > SQL Editor du projet CONSTATIO, puis « Run ».
-- Tout passe ou rien ne passe : en cas d'erreur, la base reste telle qu'elle était.
-- NE PAS relancer une seconde fois une fois qu'elle a réussi.
begin;

-- ═══ 20261122000010_stripe.sql ═══
-- =============================================================================
-- Constatio — 10 : paiements Stripe
-- -----------------------------------------------------------------------------
-- La fonction serveur « webhook-stripe » vérifie la signature du message de
-- Stripe, puis appelle stripe_recevoir. Tout le traitement est ici, dans la
-- base : atomique, et testable sans réseau.
--
--   checkout.session.completed (payée)  achat : un lot de crédits ;
--     + async_payment_succeeded         abonnement : ouverture + quota de l'année
--   invoice.paid ...................... abonnement prolongé ; nouveau quota à chaque année
--   invoice.payment_failed ............ abonnement « impayé » (Premium suspendu)
--   customer.subscription.updated ..... statut et fin de période
--   customer.subscription.deleted ..... résiliation ; le quota s'éteint
--   charge.refunded (totalité) ........ les crédits non utilisés de l'achat sont retirés
--
-- Garde-fous :
--   * un même message n'est traité qu'une fois (webhook_evenements) ;
--   * un même paiement ne crédite qu'une fois (credit_lots.reference) ;
--   * le prix n'est jamais lu dans le message : les crédits viennent de « tarifs » ;
--   * coupe-circuit : en mode test, un message « réel » (livemode) est écarté,
--     et inversement.
--
-- Quota d'un abonnement : versé en une fois pour l'année, mais utilisable
-- seulement tant que l'abonnement est payé (le lot expire à la fin de la
-- période payée, repoussée à chaque échéance réglée).
-- =============================================================================

create function private.stripe_quota(p_abo public.abonnements) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tarifs;
  -- Année d'abonnement en cours, comptée depuis son ouverture.
  v_annee integer := floor(extract(epoch from (now() - p_abo.created_at)) / (365.25 * 86400))::integer;
  v_ref   text := 'stripe:abo:' || p_abo.stripe_subscription_id || ':annee:' || v_annee;
begin
  select * into t from public.tarifs where code = p_abo.tarif_code;
  if t.credits <= 0 then return; end if;
  insert into public.credit_lots (organisation_id, origine, tarif_code, quantite, restant, expire_le, reference)
  values (p_abo.organisation_id, 'abonnement', t.code, t.credits, t.credits, p_abo.periode_fin, v_ref)
  on conflict (reference) do update set expire_le = excluded.expire_le;
  -- Le quota d'une année écoulée ne se reporte pas.
  update public.credit_lots set expire_le = least(expire_le, now())
  where organisation_id = p_abo.organisation_id and origine = 'abonnement'
    and reference like 'stripe:abo:' || p_abo.stripe_subscription_id || ':annee:%' and reference <> v_ref;
end $$;

create function private.stripe_traiter(p_evt uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_evt  public.webhook_evenements;
  p      jsonb;
  o      jsonb;                       -- l'objet porté par le message
  v_org  uuid;
  t      public.tarifs;
  a      public.abonnements;
  v_sub  text;
  v_fin  timestamptz;
  v_test boolean;
begin
  select * into v_evt from public.webhook_evenements where id = p_evt for update;
  if v_evt.traite_le is not null then return 'deja_traite'; end if;
  p := v_evt.payload;
  o := p #> '{data,object}';

  select (valeur)::text <> 'false' into v_test from public.parametres where cle = 'mode_test';
  if coalesce((p ->> 'livemode')::boolean, false) = coalesce(v_test, true) then
    update public.webhook_evenements set traite_le = now(), erreur = 'écarté : message ' ||
      case when v_test then 'réel reçu en mode test' else 'de test reçu en mode réel' end where id = p_evt;
    return 'ecarte_mode';
  end if;

  if v_evt.type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    if o ->> 'payment_status' not in ('paid', 'no_payment_required') then
      update public.webhook_evenements set traite_le = now(), erreur = 'paiement en attente' where id = p_evt;
      return 'en_attente_paiement';
    end if;
    v_org := private.uuid_ou_null(o #>> '{metadata,organisation_id}');
    select * into t from public.tarifs where code = o #>> '{metadata,tarif_code}';
    if v_org is null or t.code is null or not exists (select 1 from public.organisations where id = v_org) then
      raise exception 'Commande Stripe sans compte ou sans tarif reconnu.';
    end if;
    if o ->> 'customer' is not null then
      insert into public.organisation_facturation (organisation_id, stripe_customer_id) values (v_org, o ->> 'customer')
      on conflict (organisation_id) do update set stripe_customer_id = excluded.stripe_customer_id, updated_at = now();
    end if;
    if o ->> 'mode' = 'subscription' then
      insert into public.abonnements (organisation_id, tarif_code, statut, stripe_subscription_id, periode_debut, periode_fin)
      values (v_org, t.code, 'actif', o ->> 'subscription', now(), now() + interval '1 month')
      on conflict (stripe_subscription_id) do update set statut = 'actif'
      returning * into a;
      perform private.stripe_quota(a);
    else
      insert into public.credit_lots (organisation_id, origine, tarif_code, quantite, restant, expire_le, reference)
      values (v_org, 'achat', t.code, t.credits, t.credits, now() + make_interval(months => t.validite_mois),
              'stripe:' || coalesce(o ->> 'payment_intent', o ->> 'id'))
      on conflict (reference) do nothing;
    end if;

  elsif v_evt.type in ('invoice.paid', 'invoice.payment_failed') then
    -- Selon la version de l'API Stripe, l'abonnement est à la racine de la facture ou sous « parent ».
    v_sub := coalesce(o ->> 'subscription', o #>> '{parent,subscription_details,subscription}');
    select * into a from public.abonnements where stripe_subscription_id = v_sub for update;
    if not found then
      update public.webhook_evenements set traite_le = now(), erreur = 'abonnement inconnu' where id = p_evt;
      return 'sans_abonnement';
    end if;
    if v_evt.type = 'invoice.payment_failed' then
      update public.abonnements set statut = 'impaye' where id = a.id;
    else
      v_fin := to_timestamp((o #>> '{lines,data,0,period,end}')::double precision);
      update public.abonnements set statut = 'actif', periode_fin = greatest(periode_fin, coalesce(v_fin, periode_fin))
      where id = a.id returning * into a;
      perform private.stripe_quota(a);
    end if;

  elsif v_evt.type in ('customer.subscription.updated', 'customer.subscription.deleted') then
    select * into a from public.abonnements where stripe_subscription_id = o ->> 'id' for update;
    if not found then
      update public.webhook_evenements set traite_le = now(), erreur = 'abonnement inconnu' where id = p_evt;
      return 'sans_abonnement';
    end if;
    if v_evt.type = 'customer.subscription.deleted' or o ->> 'status' in ('canceled', 'incomplete_expired') then
      update public.abonnements set statut = 'resilie', periode_fin = least(periode_fin, now()) where id = a.id;
      update public.credit_lots set expire_le = least(expire_le, now())
      where organisation_id = a.organisation_id and origine = 'abonnement' and reference like 'stripe:abo:' || a.stripe_subscription_id || ':%';
    else
      update public.abonnements set statut = case when o ->> 'status' in ('active', 'trialing') then 'actif' else 'impaye' end where id = a.id;
    end if;

  elsif v_evt.type = 'charge.refunded' then
    if coalesce((o ->> 'refunded')::boolean, false) then
      -- Remboursement total : ce qui n'a pas servi est retiré ; ce qui a servi reste acquis au document généré.
      update public.credit_lots set restant = 0, expire_le = least(expire_le, now())
      where reference = 'stripe:' || (o ->> 'payment_intent') and origine = 'achat';
    end if;

  else
    update public.webhook_evenements set traite_le = now(), erreur = 'type non géré' where id = p_evt;
    return 'ignore';
  end if;

  update public.webhook_evenements set traite_le = now(), erreur = null where id = p_evt;
  return 'traite';
end $$;

-- Point d'entrée de la fonction serveur. Rend l'issue du traitement.
create function public.stripe_recevoir(p_message jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id  uuid;
  v_res text;
begin
  if p_message ->> 'id' is null or p_message ->> 'type' is null then
    raise exception 'Message Stripe illisible.' using errcode = 'P0001';
  end if;
  insert into public.webhook_evenements (source, evenement_id, type, payload)
  values ('stripe', p_message ->> 'id', p_message ->> 'type', p_message)
  on conflict (source, evenement_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.webhook_evenements where source = 'stripe' and evenement_id = p_message ->> 'id';
  end if;
  begin
    v_res := private.stripe_traiter(v_id);
  exception when others then
    -- Rien n'est fait à moitié (le bloc est annulé). L'erreur est gardée avec le message, qui reste
    -- « non traité » : la fonction serveur répond en échec, Stripe le renvoie, et il est retenté.
    update public.webhook_evenements set erreur = sqlerrm where id = v_id;
    return 'erreur';
  end;
  return v_res;
end $$;
revoke all on function public.stripe_recevoir(jsonb) from public, anon, authenticated;
grant execute on function public.stripe_recevoir(jsonb) to service_role;

-- Le client Stripe d'un compte, pour le serveur (commande suivante, espace de facturation).
create function public.stripe_client(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select stripe_customer_id from public.organisation_facturation where organisation_id = p_org
$$;
revoke all on function public.stripe_client(uuid) from public, anon, authenticated;
grant execute on function public.stripe_client(uuid) to service_role;

-- ═══ 20261126000011_presentation.sql ═══
-- =============================================================================
-- Constatio — 11 : présentation des documents
--   * filigrane sur les photos du document (texte choisi par le compte, suivi de
--     la date et de l'heure de la prise de vue). Les photos d'origine ne sont
--     jamais modifiées : leur empreinte reste la preuve ; le filigrane est posé
--     dans le PDF.
--   * logo du compte en tête du document : comptes professionnels (le fichier vit
--     dans le bucket « marque », chemin déjà porté par organisations.logo_path).
-- =============================================================================
alter table public.organisations
  add column filigrane_photos boolean not null default false,
  add column filigrane_texte  text check (filigrane_texte is null or char_length(filigrane_texte) <= 60);

grant update (filigrane_photos, filigrane_texte) on public.organisations to authenticated;

-- Le logo est réservé aux comptes professionnels : garantie de la base, pas seulement de l'écran.
create function private.controle_logo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.logo_path is not null and new.type <> 'pro' then
    if tg_op = 'UPDATE' and old.logo_path is not null and new.type is distinct from old.type then
      new.logo_path := null;                      -- le compte n'est plus professionnel : le logo est retiré
    else
      raise exception 'Le logo sur les documents est réservé aux comptes professionnels.' using errcode = 'P0001';
    end if;
  end if;
  if new.logo_path is not null and new.logo_path not like new.id || '/%' then
    raise exception 'Logo refusé.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger organisations_logo before insert or update on public.organisations
  for each row execute function private.controle_logo();

-- ═══ 20261126000012_cles_stripe.sql ═══
-- =============================================================================
-- Constatio — 12 : clés Stripe saisies dans l'administration
-- -----------------------------------------------------------------------------
-- Le super administrateur saisit les clés depuis l'espace d'administration ;
-- elles ne passent ni par le code, ni par un fichier de configuration.
--   * rangées dans le schéma « private », que l'API n'expose pas : aucun compte,
--     même administrateur, ne peut les relire ;
--   * en écriture seule : l'écran n'en revoit que la fin (4 caractères) et la date ;
--   * lues par les seules fonctions serveur (rôle de service) ;
--   * deux jeux, test et réel : le mode test ne sert jamais la clé réelle ;
--   * chaque saisie est journalisée, sans la valeur.
-- Elles ne sont pas chiffrées dans la base (comme une variable d'environnement
-- ne l'est pas sur un serveur) : la protection est le cloisonnement d'accès.
-- =============================================================================
create table private.cles_service (
  nom        text primary key check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel')),
  valeur     text not null,
  updated_at timestamptz not null default now(),
  par        uuid
);
revoke all on private.cles_service from public, anon, authenticated;

/** Enregistre (ou efface, valeur vide) une clé. Super administrateur seulement. */
create function public.admin_definir_cle(p_nom text, p_valeur text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_valeur, '')), '');
begin
  perform private.exiger_admin(true);
  if p_nom not in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel') then
    raise exception 'Clé inconnue.' using errcode = 'P0001';
  end if;
  if v is null then
    delete from private.cles_service where nom = p_nom;
    perform private.journal_admin('cle.effacee', p_nom);
    return;
  end if;
  -- La forme de la clé dit à quel monde elle appartient : une clé réelle ne se range pas avec les clés de test.
  if (p_nom = 'stripe_cle_test'   and v !~ '^(sk|rk)_test_[A-Za-z0-9]{16,}$')
  or (p_nom = 'stripe_cle_reelle' and v !~ '^(sk|rk)_live_[A-Za-z0-9]{16,}$')
  or (p_nom like 'stripe_webhook_%' and v !~ '^whsec_[A-Za-z0-9]{16,}$') then
    raise exception 'Cette valeur n''a pas la forme attendue pour cette clé.' using errcode = 'P0001';
  end if;
  insert into private.cles_service (nom, valeur, par) values (p_nom, v, (select auth.uid()))
  on conflict (nom) do update set valeur = excluded.valeur, updated_at = now(), par = excluded.par;
  perform private.journal_admin('cle.enregistree', p_nom, jsonb_build_object('fin', right(v, 4)));
end $$;

/** Ce que l'écran peut savoir d'une clé : qu'elle existe, sa fin, sa date. Jamais sa valeur. */
create function public.admin_cles() returns table (nom text, fin text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  return query select c.nom, right(c.valeur, 4), c.updated_at from private.cles_service c order by c.nom;
end $$;

/** Pour les fonctions serveur : les clés du mode en cours (test ou réel), et les deux secrets de webhook. */
create function public.cles_stripe() returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select coalesce((select (valeur)::text <> 'false' from public.parametres where cle = 'mode_test'), true) as test)
  select jsonb_build_object(
    'mode_test', m.test,
    'cle', (select valeur from private.cles_service where nom = case when m.test then 'stripe_cle_test' else 'stripe_cle_reelle' end),
    'webhooks', coalesce((select jsonb_agg(valeur) from private.cles_service where nom like 'stripe_webhook_%'), '[]'::jsonb))
  from m
$$;

revoke all on function public.admin_definir_cle(text, text), public.admin_cles(), public.cles_stripe() from public, anon, authenticated;
grant execute on function public.admin_definir_cle(text, text), public.admin_cles() to authenticated;
grant execute on function public.cles_stripe() to service_role;

-- ═══ 20261126000013_presentation_suite.sql ═══
-- =============================================================================
-- Constatio — 13 : image de filigrane
-- En plus du bandeau de texte, le compte peut déposer une image à fond
-- transparent (PNG), posée en transparence au centre de chaque photo du document.
-- Le fichier vit dans le bucket « marque », dans le dossier du compte.
-- =============================================================================
alter table public.organisations add column filigrane_image_path text;
grant update (filigrane_image_path) on public.organisations to authenticated;

create function private.controle_filigrane_image() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.filigrane_image_path is not null and new.filigrane_image_path not like new.id || '/%' then
    raise exception 'Image de filigrane refusée.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger organisations_filigrane_image before insert or update on public.organisations
  for each row execute function private.controle_filigrane_image();

-- Photos du document sur deux ou trois colonnes (tous les comptes), et couleur
-- d'accent du document (comptes professionnels ; ignorée pour les autres).
alter table public.organisations
  add column photos_colonnes   smallint not null default 2 check (photos_colonnes in (2, 3)),
  add column couleur_documents text check (couleur_documents is null or couleur_documents ~ '^#[0-9a-f]{6}$');
grant update (photos_colonnes, couleur_documents) on public.organisations to authenticated;

-- ═══ 20261126000014_compteurs.sql ═══
-- =============================================================================
-- Constatio — 14 : compteurs
--   * eau : compteur individuel ou collectif ;
--   * « compteur vérifié » : on a fait couler l'eau et constaté que ce compteur
--     tourne — c'est bien celui du logement (erreur fréquente en immeuble) ;
--   * chauffage collectif : relevé du compteur de chaleur ou des répartiteurs.
-- =============================================================================
alter type public.compteur_type add value if not exists 'chauffage';
alter table public.edl_compteurs
  add column collectif boolean not null default false,
  add column verifie   boolean not null default false;

-- ═══ 20261126000015_signature_electronique.sql ═══
-- =============================================================================
-- Constatio — 15 : signature électronique par un prestataire (DocuSeal)
-- -----------------------------------------------------------------------------
-- À la fin d'un état des lieux, deux façons de signer :
--   * à la main sur l'écran, horodatée — comprise dans le crédit ;
--   * par signature électronique DocuSeal, envoyée par e-mail à chaque partie —
--     5 € par état des lieux, payés avant l'envoi.
-- L'une exclut l'autre : pas de document à moitié signé d'une façon, à moitié de l'autre.
-- La clé DocuSeal (la même que Signabail) se saisit dans l'administration.
-- =============================================================================
insert into public.tarifs (code, libelle, montant_cents, periodicite, credits, validite_mois)
values ('signature_electronique', 'Signature électronique (par état des lieux)', 500, 'unique', 0, 24)
on conflict (code) do nothing;

-- Suivi par état des lieux. À part de la table « edl » : celle-ci est figée une fois le document généré.
create table public.edl_signature_electronique (
  edl_id        uuid primary key references public.edl (id) on delete cascade,
  payee_le      timestamptz not null default now(),
  paiement      text unique,                       -- référence Stripe
  demande_id    text,                              -- demande de signature chez le prestataire
  demandee_le   timestamptz,
  statut        text not null default 'payee' check (statut in ('payee', 'en_signature', 'signee')),
  liens         jsonb not null default '[]',       -- lien de signature de chaque partie, tel que rendu par le prestataire
  updated_at    timestamptz not null default now()
);
alter table public.edl_signature_electronique enable row level security;
grant select on public.edl_signature_electronique to authenticated;
create policy edl_signature_electronique_lecture on public.edl_signature_electronique for select to authenticated
  using (private.edl_de_mon_organisation(edl_id));

alter table public.edl_signatures drop constraint edl_signatures_mode_check;
alter table public.edl_signatures add constraint edl_signatures_mode_check check (mode in ('sur_place', 'a_distance', 'electronique'));

-- Clés : DocuSeal s'ajoute à Stripe.
alter table private.cles_service drop constraint cles_service_nom_check;
alter table private.cles_service add constraint cles_service_nom_check
  check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url'));

create or replace function public.admin_definir_cle(p_nom text, p_valeur text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_valeur, '')), '');
begin
  perform private.exiger_admin(true);
  if p_nom not in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url') then
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
  or (p_nom = 'docuseal_url' and v !~ '^https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9/_-]*)?$') then
    raise exception 'Cette valeur n''a pas la forme attendue pour cette clé.' using errcode = 'P0001';
  end if;
  insert into private.cles_service (nom, valeur, par) values (p_nom, v, (select auth.uid()))
  on conflict (nom) do update set valeur = excluded.valeur, updated_at = now(), par = excluded.par;
  -- Une adresse n'est pas un secret : elle se relit en entier dans le journal ; une clé, seulement sa fin.
  perform private.journal_admin('cle.enregistree', p_nom, jsonb_build_object('fin', case when p_nom = 'docuseal_url' then v else right(v, 4) end));
end $$;

/** Pour les fonctions serveur : la clé DocuSeal et l'adresse de son API. */
create function public.cles_docuseal() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode_test', coalesce((select (valeur)::text <> 'false' from public.parametres where cle = 'mode_test'), true),
    'cle', (select valeur from private.cles_service where nom = 'docuseal_cle'),
    'url', coalesce((select valeur from private.cles_service where nom = 'docuseal_url'), 'https://api.docuseal.eu'))
$$;
revoke all on function public.cles_docuseal() from public, anon, authenticated;
grant execute on function public.cles_docuseal() to service_role;

-- Paiement des 5 € : reconnu à l'arrivée du message de Stripe, avant le traitement des crédits.
create function private.stripe_signature(p_evt uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_evt  public.webhook_evenements;
  o      jsonb;
  v_edl  uuid;
  v_test boolean;
begin
  select * into v_evt from public.webhook_evenements where id = p_evt for update;
  if v_evt.traite_le is not null then return 'deja_traite'; end if;
  o := v_evt.payload #> '{data,object}';
  select (valeur)::text <> 'false' into v_test from public.parametres where cle = 'mode_test';
  if coalesce((v_evt.payload ->> 'livemode')::boolean, false) = coalesce(v_test, true) then
    update public.webhook_evenements set traite_le = now(), erreur = 'écarté : mode test et message ne concordent pas' where id = p_evt;
    return 'ecarte_mode';
  end if;
  if o ->> 'payment_status' not in ('paid', 'no_payment_required') then
    update public.webhook_evenements set traite_le = now(), erreur = 'paiement en attente' where id = p_evt;
    return 'en_attente_paiement';
  end if;
  v_edl := private.uuid_ou_null(o #>> '{metadata,edl_id}');
  if v_edl is null or not exists (select 1 from public.edl where id = v_edl and organisation_id = private.uuid_ou_null(o #>> '{metadata,organisation_id}')) then
    raise exception 'Paiement de signature sans état des lieux reconnu.';
  end if;
  insert into public.edl_signature_electronique (edl_id, paiement) values (v_edl, 'stripe:' || coalesce(o ->> 'payment_intent', o ->> 'id'))
  on conflict (edl_id) do nothing;
  insert into public.edl_journal (edl_id, evenement, details) values (v_edl, 'signature_electronique_payee', jsonb_build_object('paiement', coalesce(o ->> 'payment_intent', o ->> 'id')));
  update public.webhook_evenements set traite_le = now(), erreur = null where id = p_evt;
  return 'traite';
end $$;

create or replace function public.stripe_recevoir(p_message jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id  uuid;
  v_res text;
begin
  if p_message ->> 'id' is null or p_message ->> 'type' is null then
    raise exception 'Message Stripe illisible.' using errcode = 'P0001';
  end if;
  insert into public.webhook_evenements (source, evenement_id, type, payload)
  values ('stripe', p_message ->> 'id', p_message ->> 'type', p_message)
  on conflict (source, evenement_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.webhook_evenements where source = 'stripe' and evenement_id = p_message ->> 'id';
  end if;
  begin
    if p_message ->> 'type' in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
       and p_message #>> '{data,object,metadata,tarif_code}' = 'signature_electronique' then
      v_res := private.stripe_signature(v_id);
    else
      v_res := private.stripe_traiter(v_id);
    end if;
  exception when others then
    update public.webhook_evenements set erreur = sqlerrm where id = v_id;
    return 'erreur';
  end;
  return v_res;
end $$;

-- Demande envoyée au prestataire (ou retenue, en mode test).
create function public.edl_signature_demandee(p_edl uuid, p_demande text, p_liens jsonb, p_acteur uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.edl_signatures where edl_id = p_edl) then
    raise exception 'Une partie a déjà signé à la main : la signature électronique n''est plus possible.' using errcode = 'P0001';
  end if;
  update public.edl_signature_electronique set demande_id = p_demande, demandee_le = now(), statut = 'en_signature', liens = coalesce(p_liens, '[]'), updated_at = now()
  where edl_id = p_edl and statut in ('payee', 'en_signature');
  if not found then raise exception 'La signature électronique de cet état des lieux n''est pas réglée.' using errcode = 'P0001'; end if;
  insert into public.edl_journal (edl_id, evenement, acteur_id, details) values (p_edl, 'signature_electronique_envoyee', p_acteur, jsonb_build_object('demande', p_demande));
end $$;

-- Demande refusée, expirée ou annulée chez le prestataire : on peut la renvoyer, sans repayer.
create function public.edl_signature_annulee(p_edl uuid) returns void
language sql security definer set search_path = '' as $$
  update public.edl_signature_electronique set demande_id = null, demandee_le = null, statut = 'payee', liens = '[]', updated_at = now()
  where edl_id = p_edl and statut = 'en_signature'
$$;

-- Toutes les parties ont signé chez le prestataire : le document signé est déposé et l'état des lieux clos.
create function public.edl_clore_electronique(p_edl uuid, p_chemin text, p_sha256 text)
returns public.edl language plpgsql security definer set search_path = '' as $$
declare
  e public.edl;
  s public.edl_signature_electronique;
begin
  select * into e from public.edl where id = p_edl for update;
  select * into s from public.edl_signature_electronique where edl_id = p_edl for update;
  if e.statut = 'signe' then return e; end if;
  if e.id is null or e.statut <> 'termine' or e.pdf_sha256 is null or s.demande_id is null or s.statut <> 'en_signature' then
    raise exception 'Aucune demande de signature électronique en cours pour cet état des lieux.' using errcode = 'P0001';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_chemin not like e.organisation_id || '/' || e.id || '/pdf/%' then
    raise exception 'Document refusé.' using errcode = 'P0001';
  end if;
  insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256, fournisseur, fournisseur_ref)
  select p_edl, p.id, 'electronique', e.pdf_sha256, 'docuseal', s.demande_id from public.edl_parties p where p.edl_id = p_edl and p.doit_signer;
  update public.edl_signature_electronique set statut = 'signee', updated_at = now() where edl_id = p_edl;
  update public.edl set statut = 'signe', signe_le = now(), pdf_signe_path = p_chemin, pdf_signe_sha256 = p_sha256 where id = p_edl returning * into e;
  insert into public.edl_journal (edl_id, evenement, details)
  values (p_edl, 'signe', jsonb_build_object('pdf_sha256', e.pdf_sha256, 'pdf_signe_sha256', p_sha256, 'prestataire', 'docuseal', 'demande', s.demande_id));
  return e;
end $$;

do $$
declare f text;
begin
  foreach f in array array['edl_signature_demandee(uuid, text, jsonb, uuid)', 'edl_signature_annulee(uuid)', 'edl_clore_electronique(uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ═══ 20261126000016_releve_automatique.sql ═══
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

-- Adresse des fonctions du projet, pour la relève automatique des signatures.
update public.parametres set valeur = '"https://nuholtipxbuvhtvltvdq.supabase.co/functions/v1"' where cle = 'url_fonctions';
commit;
