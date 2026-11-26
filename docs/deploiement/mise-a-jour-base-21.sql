begin;
-- =============================================================================
-- Constatio — 21 : les e-mails de compte passent par la même boîte
-- -----------------------------------------------------------------------------
-- Confirmation d'adresse, mot de passe oublié, changement d'adresse : le service de
-- comptes confie l'envoi à la fonction « courriel » (« Send Email Hook »). La boîte
-- d'envoi ne se règle donc qu'à un seul endroit, l'administration de Constatio.
-- L'appel est signé ; le secret de signature est tiré au déploiement et rangé ici.
-- =============================================================================
alter table private.cles_service drop constraint cles_service_nom_check;
alter table private.cles_service add constraint cles_service_nom_check
  check (nom in ('stripe_cle_test', 'stripe_webhook_test', 'stripe_cle_reelle', 'stripe_webhook_reel', 'docuseal_cle', 'docuseal_url', 'releve_secret',
                 'smtp_utilisateur', 'smtp_mot_de_passe', 'smtp_hote', 'comptes_secret'));

create or replace function public.cles_courriel() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode_test', coalesce((select (valeur)::text <> 'false' from public.parametres where cle = 'mode_test'), true),
    'hote', coalesce((select valeur from private.cles_service where nom = 'smtp_hote'), 'smtp.hostinger.com:465'),
    'utilisateur', (select valeur from private.cles_service where nom = 'smtp_utilisateur'),
    'mot_de_passe', (select valeur from private.cles_service where nom = 'smtp_mot_de_passe'),
    'comptes_secret', (select valeur from private.cles_service where nom = 'comptes_secret'))
$$;

-- L'écran d'administration ne liste pas les secrets techniques.
create or replace function public.admin_cles() returns table (nom text, fin text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger_admin(true);
  return query select c.nom, case when c.nom in ('docuseal_url', 'smtp_utilisateur', 'smtp_hote') then c.valeur when c.nom = 'smtp_mot_de_passe' then '••••' else right(c.valeur, 4) end, c.updated_at
  from private.cles_service c where c.nom not in ('releve_secret', 'comptes_secret') order by c.nom;
end $$;
commit;
