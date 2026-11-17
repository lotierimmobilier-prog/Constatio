-- =============================================================================
-- Constatio — 6 : messages reçus de Signabail
-- -----------------------------------------------------------------------------
-- Spécification : docs/03-echanges-signabail.html.
-- La fonction serveur « webhook-signabail » vérifie la signature du message,
-- puis appelle signabail_recevoir. Tout le traitement est ici, dans la base :
-- il est atomique (crédit et brouillon ensemble, ou rien) et testable sans réseau.
--
--   bail.signe ............. 1 crédit d'EDL d'entrée + brouillon pré-rempli
--   bail.annule ............ retrait du crédit s'il n'a pas servi
--   offre_groupee.achetee .. 2 crédits : un pour l'entrée, un pour la sortie
--   compte.supprime ........ le lien entre les deux comptes est effacé
--
-- Garde-fous :
--   * un même message n'est traité qu'une fois (webhook_evenements) ;
--   * un même bail ne crédite qu'une fois (credit_lots.reference) ;
--   * client pas encore inscrit : le message attend, et est traité quand le
--     compte Signabail est rattaché (signabail_rattacher) ;
--   * un message de test ne touche que les comptes de recette.
-- =============================================================================

create function private.signabail_traiter(p_evt uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_evt    public.webhook_evenements;
  p        jsonb;
  bail     jsonb;
  v_org    public.organisations;
  v_bail   text;
  v_signe  timestamptz;
  v_expire timestamptz;
  v_log    uuid;
  v_edl    uuid;
  v_ordre  smallint := 0;
  v_ligne  jsonb;
  v_issue  text := 'traite';
begin
  select * into v_evt from public.webhook_evenements where id = p_evt for update;
  if v_evt.traite_le is not null then return 'deja_traite'; end if;
  p := v_evt.payload;

  select * into v_org from public.organisations where signabail_compte_id = p #>> '{compte,id}';
  if not found then return 'en_attente'; end if;   -- traité au rattachement du compte

  if coalesce((p ->> 'test')::boolean, false) and not v_org.est_test then
    v_issue := 'ignore_test';

  elsif v_evt.type = 'bail.signe' then
    bail    := p -> 'bail';
    v_bail  := bail ->> 'id';
    v_signe := coalesce((bail ->> 'signe_le')::timestamptz, v_evt.created_at);
    v_expire := v_signe + interval '24 months';
    if bail ->> 'type' not in ('vide', 'meuble', 'mobilite', 'etudiant', 'colocation') then
      v_issue := 'sans_offre';                      -- garage, bail commercial… : pas d'EDL offert
    else
      -- Crédit offert : valable pour une entrée seulement, 24 mois à compter de la signature du bail.
      -- Le bail d'une offre groupée ne donne pas un EDL gratuit en plus.
      if v_expire > now() and not coalesce((p ->> 'offre_groupee')::boolean, false) then
        insert into public.credit_lots (organisation_id, origine, quantite, restant, type_reserve, expire_le, reference)
        values (v_org.id, 'signabail', 1, 1, 'entrant', v_expire, 'signabail:bail:' || v_bail)
        on conflict (reference) do nothing;
      end if;

      -- Brouillon pré-rempli, une seule fois par bail.
      if not exists (select 1 from public.edl where organisation_id = v_org.id and signabail_bail_id = v_bail) then
        select id into v_log from public.logements
        where organisation_id = v_org.id and code_postal = bail #>> '{logement,code_postal}'
          and lower(trim(adresse)) = lower(trim(bail #>> '{logement,adresse}'))
          and coalesce(complement, '') = coalesce(bail #>> '{logement,complement}', '')
        limit 1;
        if v_log is null then
          insert into public.logements (organisation_id, libelle, type_bien, adresse, complement, code_postal, ville, surface_m2, meuble)
          values (v_org.id,
                  concat_ws(', ', bail #>> '{logement,adresse}', bail #>> '{logement,ville}'),
                  case when bail #>> '{logement,type_bien}' in ('studio', 'appartement', 'maison', 'garage', 'local')
                       then bail #>> '{logement,type_bien}' else 'appartement' end,
                  bail #>> '{logement,adresse}', nullif(bail #>> '{logement,complement}', ''),
                  bail #>> '{logement,code_postal}', bail #>> '{logement,ville}',
                  nullif(bail #>> '{logement,surface_m2}', '')::numeric,
                  coalesce((bail #>> '{logement,meuble}')::boolean, false))
          returning id into v_log;
        end if;

        insert into public.edl (organisation_id, logement_id, type, date_edl, bail_type, bail_date_entree,
                                depot_garantie_cents, source, signabail_bail_id)
        values (v_org.id, v_log, 'entrant',
                coalesce((bail ->> 'date_entree')::timestamptz, now()),
                (bail ->> 'type')::public.bail_type, (bail ->> 'date_entree')::date,
                round((bail ->> 'depot_garantie')::numeric * 100)::integer, 'signabail', v_bail)
        returning id into v_edl;

        insert into public.edl_parties (edl_id, role, civilite, prenom, nom, email, telephone, adresse, ordre)
        values (v_edl, 'bailleur', bail #>> '{bailleur,civilite}', coalesce(bail #>> '{bailleur,prenom}', ''),
                bail #>> '{bailleur,nom}', bail #>> '{bailleur,email}', bail #>> '{bailleur,telephone}',
                bail #>> '{bailleur,adresse}', 0);
        for v_ligne in select * from jsonb_array_elements(coalesce(bail -> 'locataires', '[]')) loop
          v_ordre := v_ordre + 1;
          insert into public.edl_parties (edl_id, role, civilite, prenom, nom, email, telephone, ordre)
          values (v_edl, 'locataire', v_ligne ->> 'civilite', coalesce(v_ligne ->> 'prenom', ''), v_ligne ->> 'nom',
                  v_ligne ->> 'email', v_ligne ->> 'telephone', v_ordre);
        end loop;

        -- Les pièces du bail ; leurs éléments sont ajoutés par l'application, qui détient la trame.
        v_ordre := 0;
        for v_ligne in select * from jsonb_array_elements(coalesce(bail #> '{logement,pieces}', '[]')) loop
          insert into public.edl_pieces (edl_id, nom, ordre) values (v_edl, v_ligne #>> '{}', v_ordre);
          v_ordre := v_ordre + 1;
        end loop;

        insert into public.edl_journal (edl_id, evenement, details)
        values (v_edl, 'cree', jsonb_build_object('source', 'signabail', 'bail', v_bail, 'evenement', v_evt.evenement_id));
      end if;
    end if;

  elsif v_evt.type = 'bail.annule' then
    -- Le crédit n'est retiré que s'il n'a pas servi ; le brouillon reste.
    delete from public.credit_lots
    where organisation_id = v_org.id and reference = 'signabail:bail:' || (p #>> '{bail,id}') and restant = quantite;

  elsif v_evt.type = 'offre_groupee.achetee' then
    v_expire := coalesce((p #>> '{offre,achetee_le}')::timestamptz, v_evt.created_at) + interval '24 months';
    insert into public.credit_lots (organisation_id, origine, tarif_code, quantite, restant, type_reserve, expire_le, reference)
    values (v_org.id, 'signabail', 'offre_groupee', 1, 1, 'entrant', v_expire, 'signabail:groupe:' || (p #>> '{offre,id}') || ':entree'),
           (v_org.id, 'signabail', 'offre_groupee', 1, 1, 'sortant', v_expire, 'signabail:groupe:' || (p #>> '{offre,id}') || ':sortie')
    on conflict (reference) do nothing;

  elsif v_evt.type = 'compte.supprime' then
    update public.organisations set signabail_compte_id = null where id = v_org.id;

  else
    v_issue := 'type_inconnu';
  end if;

  update public.webhook_evenements
  set traite_le = now(), erreur = case when v_issue in ('traite', 'sans_offre') then null else v_issue end
  where id = p_evt;
  return v_issue;
end $$;

/** Point d'entrée : enregistre le message (une seule fois) puis le traite. */
create function public.signabail_recevoir(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_evt uuid;
begin
  if p ->> 'id' is null or p ->> 'type' is null or p #>> '{compte,id}' is null then
    raise exception 'Message Signabail incomplet : id, type et compte.id sont obligatoires.' using errcode = '22023';
  end if;
  insert into public.webhook_evenements (source, evenement_id, type, payload)
  values ('signabail', p ->> 'id', p ->> 'type', p)
  on conflict (source, evenement_id) do nothing
  returning id into v_evt;
  if v_evt is null then return 'deja_recu'; end if;
  return private.signabail_traiter(v_evt);
end $$;

/** Lie un compte Signabail à une organisation, puis traite les messages qui l'attendaient. */
create function public.signabail_rattacher(p_organisation uuid, p_compte text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_evt uuid; n integer := 0;
begin
  update public.organisations set signabail_compte_id = p_compte where id = p_organisation;
  if not found then raise exception 'Organisation introuvable.' using errcode = 'P0002'; end if;
  for v_evt in
    select id from public.webhook_evenements
    where source = 'signabail' and traite_le is null and payload #>> '{compte,id}' = p_compte
    order by created_at
  loop
    perform private.signabail_traiter(v_evt);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Réservées au serveur : le navigateur ne peut ni fabriquer un message, ni se rattacher lui-même.
revoke execute on function public.signabail_recevoir(jsonb), public.signabail_rattacher(uuid, text) from public, anon, authenticated;
grant execute on function public.signabail_recevoir(jsonb), public.signabail_rattacher(uuid, text) to service_role;
revoke execute on function private.signabail_traiter(uuid) from public, anon, authenticated;
