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
