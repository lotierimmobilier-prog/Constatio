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
