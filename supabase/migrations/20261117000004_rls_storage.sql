-- =============================================================================
-- Constatio — 4/5 : règles d'accès (RLS), droits et stockage des fichiers
-- -----------------------------------------------------------------------------
-- Principe : tout est fermé par défaut. Trois niveaux d'accès :
--   * membre de l'organisation ....... lit tout, écrit tant que l'EDL n'est pas signé ;
--   * partie liée à un compte ......... (locataire) lit ses EDL signés, rien d'autre ;
--   * serveur (service_role) .......... crédits, paiements, signatures, PDF, webhooks.
-- Le rôle « anon » n'a aucun accès aux données : les liens de signature à
-- distance passent par une fonction serveur qui vérifie le jeton.
-- =============================================================================

create function private.edl_lisible(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl e
    where e.id = p_edl and (
      private.est_membre(e.organisation_id)
      or (e.statut = 'signe' and exists (
            select 1 from public.edl_parties p
            where p.edl_id = e.id and p.user_id = (select auth.uid())))
    )
  )
$$;

create function private.edl_modifiable(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edl e
    where e.id = p_edl and e.statut <> 'signe' and private.est_membre(e.organisation_id)
  )
$$;

create function private.edl_de_mon_organisation(p_edl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.edl e where e.id = p_edl and private.est_membre(e.organisation_id))
$$;

create function private.uuid_ou_null(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- RLS activée partout ------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Comptes ------------------------------------------------------------------------
grant select, update (prenom, nom, telephone) on public.profils to authenticated;
create policy profils_lecture on public.profils for select to authenticated
  using (id = (select auth.uid()));
create policy profils_maj on public.profils for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select on public.organisations to authenticated;
grant update (type, nom, siret, adresse, code_postal, ville, carte_pro_numero, carte_pro_cci,
              logo_path, entete, pied_de_page) on public.organisations to authenticated;
create policy organisations_lecture on public.organisations for select to authenticated
  using (private.est_membre(id));
create policy organisations_maj on public.organisations for update to authenticated
  using (private.est_admin(id)) with check (private.est_admin(id));

grant select, insert, update, delete on public.organisation_membres to authenticated;
create policy membres_lecture on public.organisation_membres for select to authenticated
  using (private.est_membre(organisation_id));
-- Seul un administrateur gère l'équipe ; personne ne se nomme propriétaire.
create policy membres_ajout on public.organisation_membres for insert to authenticated
  with check (private.est_admin(organisation_id) and role <> 'proprietaire');
create policy membres_maj on public.organisation_membres for update to authenticated
  using (private.est_admin(organisation_id) and role <> 'proprietaire')
  with check (private.est_admin(organisation_id) and role <> 'proprietaire');
create policy membres_retrait on public.organisation_membres for delete to authenticated
  using (private.est_admin(organisation_id) and role <> 'proprietaire');

-- organisation_facturation : aucune règle, donc aucun accès hors serveur.

-- Logements ----------------------------------------------------------------------
grant select, insert, update, delete on public.logements to authenticated;
create policy logements_tout on public.logements for all to authenticated
  using (private.est_membre(organisation_id)) with check (private.est_membre(organisation_id));

-- EDL ----------------------------------------------------------------------------
-- Colonnes interdites au navigateur : statut, credit_consomme, genere_le,
-- pdf_path, pdf_sha256, signe_le (cycle de vie), organisation_id (pas de
-- transfert d'un compte à l'autre).
grant select, delete on public.edl to authenticated;
grant insert (id, organisation_id, logement_id, type, date_edl, entree_id, date_edl_entree, bail_type,
              bail_date_entree, depot_garantie_cents, realise_par, realise_par_nom, remarques_generales,
              debut_periode_chauffe, grille_vetuste_id, source, signabail_bail_id, lotier_edl_ref)
  on public.edl to authenticated;
grant update (logement_id, type, date_edl, entree_id, date_edl_entree, bail_type, bail_date_entree,
              depot_garantie_cents, realise_par, realise_par_nom, remarques_generales,
              debut_periode_chauffe, grille_vetuste_id)
  on public.edl to authenticated;
create policy edl_lecture on public.edl for select to authenticated
  using (private.edl_lisible(id));
create policy edl_creation on public.edl for insert to authenticated
  with check (private.est_membre(organisation_id));
create policy edl_maj on public.edl for update to authenticated
  using (private.est_membre(organisation_id)) with check (private.est_membre(organisation_id));
-- Un EDL déjà généré ne se supprime pas depuis l'application.
create policy edl_suppression on public.edl for delete to authenticated
  using (private.est_membre(organisation_id) and statut = 'brouillon' and not credit_consomme);

-- Contenu de l'EDL : mêmes règles pour toutes les tables filles.
do $$
declare t text;
begin
  foreach t in array array['edl_parties', 'edl_pieces', 'edl_elements', 'edl_compteurs',
                           'edl_cles', 'edl_inventaire', 'edl_photos'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.edl_lisible(edl_id))', t || '_lecture', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.edl_modifiable(edl_id))', t || '_ajout', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.edl_modifiable(edl_id)) with check (private.edl_modifiable(edl_id))', t || '_maj', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.edl_modifiable(edl_id))', t || '_retrait', t);
  end loop;
end $$;

-- Signatures et journal : lecture seule ; l'écriture est faite par le serveur.
grant select on public.edl_signatures, public.edl_journal to authenticated;
create policy edl_signatures_lecture on public.edl_signatures for select to authenticated
  using (private.edl_lisible(edl_id));
create policy edl_journal_lecture on public.edl_journal for select to authenticated
  using (private.edl_de_mon_organisation(edl_id));
-- edl_jetons : aucune règle, serveur uniquement.

-- Compléments : demandés par une partie de l'EDL, traités par l'organisation.
grant select, insert on public.edl_complements to authenticated;
grant update (statut, reponse, repondu_le) on public.edl_complements to authenticated;
create policy edl_complements_lecture on public.edl_complements for select to authenticated
  using (private.edl_lisible(edl_id));
create policy edl_complements_demande on public.edl_complements for insert to authenticated
  with check (statut = 'demande' and exists (
    select 1 from public.edl_parties p
    where p.id = partie_id and p.edl_id = edl_complements.edl_id and p.user_id = (select auth.uid())));
create policy edl_complements_reponse on public.edl_complements for update to authenticated
  using (private.edl_de_mon_organisation(edl_id)) with check (private.edl_de_mon_organisation(edl_id));

-- Référentiels et tarifs : lecture pour tous, y compris le site vitrine.
grant select on public.ref_mobilier_decret to anon, authenticated;
grant select (code, libelle, montant_cents, periodicite, credits, validite_mois, actif) on public.tarifs to anon, authenticated;
create policy ref_mobilier_lecture on public.ref_mobilier_decret for select to anon, authenticated using (true);
create policy tarifs_lecture on public.tarifs for select to anon, authenticated using (actif);
grant select on public.parametres to anon, authenticated;
create policy parametres_lecture on public.parametres for select to anon, authenticated
  using (cle = 'mode_test');

-- Vétusté ------------------------------------------------------------------------
grant select, insert, update, delete on public.grilles_vetuste, public.grille_vetuste_lignes to authenticated;
create policy grilles_lecture on public.grilles_vetuste for select to authenticated
  using (organisation_id is null or private.est_membre(organisation_id));
create policy grilles_ajout on public.grilles_vetuste for insert to authenticated
  with check (organisation_id is not null and private.est_admin(organisation_id));
create policy grilles_maj on public.grilles_vetuste for update to authenticated
  using (organisation_id is not null and private.est_admin(organisation_id))
  with check (organisation_id is not null and private.est_admin(organisation_id));
create policy grilles_retrait on public.grilles_vetuste for delete to authenticated
  using (organisation_id is not null and private.est_admin(organisation_id));

create function private.grille_org(p_grille uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select organisation_id from public.grilles_vetuste where id = p_grille
$$;
create policy grille_lignes_lecture on public.grille_vetuste_lignes for select to authenticated
  using (private.grille_org(grille_id) is null or private.est_membre(private.grille_org(grille_id)));
create policy grille_lignes_ajout on public.grille_vetuste_lignes for insert to authenticated
  with check (private.est_admin(private.grille_org(grille_id)));
create policy grille_lignes_maj on public.grille_vetuste_lignes for update to authenticated
  using (private.est_admin(private.grille_org(grille_id)))
  with check (private.est_admin(private.grille_org(grille_id)));
create policy grille_lignes_retrait on public.grille_vetuste_lignes for delete to authenticated
  using (private.est_admin(private.grille_org(grille_id)));

-- Sortie : retenues et décompte, réservés à l'organisation. Le locataire reçoit
-- le décompte par courrier, il ne lit pas le dossier de travail du bailleur.
grant select, insert, update, delete on public.retenues, public.decomptes to authenticated;
create policy retenues_tout on public.retenues for all to authenticated
  using (private.edl_de_mon_organisation(edl_id)) with check (private.edl_de_mon_organisation(edl_id));
create policy decomptes_tout on public.decomptes for all to authenticated
  using (private.edl_de_mon_organisation(edl_id)) with check (private.edl_de_mon_organisation(edl_id));

-- Facturation : lecture seule pour les membres, écriture par le serveur (webhooks Stripe).
grant select on public.credit_lots, public.credit_consommations, public.abonnements, public.reservations to authenticated;
create policy credit_lots_lecture on public.credit_lots for select to authenticated
  using (private.est_membre(organisation_id));
create policy credit_consommations_lecture on public.credit_consommations for select to authenticated
  using (private.est_membre(organisation_id));
create policy abonnements_lecture on public.abonnements for select to authenticated
  using (private.est_membre(organisation_id));
create policy reservations_lecture on public.reservations for select to authenticated
  using (private.est_membre(organisation_id));

-- Clés d'API : l'empreinte n'est jamais lisible ; création et révocation par le serveur.
grant select (id, organisation_id, nom, prefixe, cree_par, derniere_utilisation, revoquee_le, created_at)
  on public.api_cles to authenticated;
create policy api_cles_lecture on public.api_cles for select to authenticated
  using (private.est_admin(organisation_id));
-- webhook_evenements : aucune règle, serveur uniquement.

-- Fonctions du cycle de vie -----------------------------------------------------
revoke execute on function public.edl_finaliser(uuid), public.edl_rouvrir(uuid), public.edl_marquer_signe(uuid) from public, anon;
grant execute on function public.edl_finaliser(uuid), public.edl_rouvrir(uuid) to authenticated;
grant execute on function public.edl_marquer_signe(uuid) to service_role;

grant usage on schema private to authenticated, anon;

-- =============================================================================
-- Stockage des fichiers
--   bucket « edl »    : {organisation}/{edl}/photos|signatures|justificatifs|pdf/…
--   bucket « marque » : {organisation}/logo.png
-- Privés tous les deux : chaque fichier est servi par URL signée de courte durée.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('edl', 'edl', false, 8388608, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf']),
  ('marque', 'marque', false, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do nothing;

create policy edl_fichiers_lecture on storage.objects for select to authenticated
  using (bucket_id = 'edl' and private.edl_lisible(private.uuid_ou_null((storage.foldername(name))[2])));

-- Dépôt : dans le dossier de sa propre organisation, sur un EDL non signé, et
-- jamais dans « pdf » ni « signatures » (écrits par le serveur).
create policy edl_fichiers_depot on storage.objects for insert to authenticated
  with check (
    bucket_id = 'edl'
    and (storage.foldername(name))[3] in ('photos', 'justificatifs', 'procurations')
    and private.est_membre(private.uuid_ou_null((storage.foldername(name))[1]))
    and private.edl_modifiable(private.uuid_ou_null((storage.foldername(name))[2]))
  );
-- Pas de règle UPDATE : un fichier déposé ne se remplace pas.
create policy edl_fichiers_retrait on storage.objects for delete to authenticated
  using (
    bucket_id = 'edl'
    and (storage.foldername(name))[3] in ('photos', 'justificatifs', 'procurations')
    and private.edl_modifiable(private.uuid_ou_null((storage.foldername(name))[2]))
  );

create policy marque_lecture on storage.objects for select to authenticated
  using (bucket_id = 'marque' and private.est_membre(private.uuid_ou_null((storage.foldername(name))[1])));
create policy marque_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'marque' and private.est_admin(private.uuid_ou_null((storage.foldername(name))[1])));
create policy marque_maj on storage.objects for update to authenticated
  using (bucket_id = 'marque' and private.est_admin(private.uuid_ou_null((storage.foldername(name))[1])));
create policy marque_retrait on storage.objects for delete to authenticated
  using (bucket_id = 'marque' and private.est_admin(private.uuid_ou_null((storage.foldername(name))[1])));
