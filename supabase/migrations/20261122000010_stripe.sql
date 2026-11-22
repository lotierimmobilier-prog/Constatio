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
