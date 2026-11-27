begin;
-- =============================================================================
-- Constatio — 23 : le secret partagé avec Signabail se saisit dans l'administration
-- -----------------------------------------------------------------------------
-- Il signe les messages « bail généré » et les liens de passage. Le même doit être
-- saisi dans l'administration de Signabail. Écriture seule, comme les autres clés.
-- =============================================================================
alter table private.cles_service drop constraint cles_service_nom_check;
alter table private.cles_service add constraint cles_service_nom_check
  check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'releve_secret',
                 'smtp_utilisateur', 'smtp_mot_de_passe', 'smtp_hote', 'comptes_secret', 'signabail_secret'));

create or replace function public.admin_definir_cle(p_nom text, p_valeur text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_valeur, '')), '');
  v_lisible boolean := p_nom in ('docuseal_url', 'smtp_utilisateur', 'smtp_hote');
begin
  perform private.exiger_admin(true);
  if p_nom not in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'smtp_utilisateur', 'smtp_mot_de_passe', 'smtp_hote', 'signabail_secret') then
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
  or (p_nom = 'smtp_mot_de_passe' and (char_length(v) < 8 or v ~ '[\r\n]'))
  -- Assez long pour ne pas se deviner : 32 caractères au moins.
  or (p_nom = 'signabail_secret' and v !~ '^[A-Za-z0-9_-]{32,128}$') then
    raise exception 'Cette valeur n''a pas la forme attendue pour cette clé.' using errcode = 'P0001';
  end if;
  insert into private.cles_service (nom, valeur, par) values (p_nom, v, (select auth.uid()))
  on conflict (nom) do update set valeur = excluded.valeur, updated_at = now(), par = excluded.par;
  perform private.journal_admin('cle.enregistree', p_nom, jsonb_build_object('fin', case when v_lisible then v when p_nom = 'smtp_mot_de_passe' then '••••' else right(v, 4) end));
end $$;

/** Pour les fonctions serveur qui reçoivent Signabail. */
create function public.cle_signabail() returns text
language sql stable security definer set search_path = '' as $$
  select valeur from private.cles_service where nom = 'signabail_secret'
$$;
revoke all on function public.cle_signabail() from public, anon, authenticated;
grant execute on function public.cle_signabail() to service_role;
commit;
