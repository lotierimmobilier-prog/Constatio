-- =============================================================================
-- Constatio — 5/5 : export au format des tables Collab
-- -----------------------------------------------------------------------------
-- Format relevé dans le dépôt Collab (src/lib/edl2.ts, prisma/migrations_edl2.sql) :
--   edl2(id, type, statut, date, lotId, lotLabel, adresse, tenantId, locataireNom,
--        entreeId, contenu jsonb, agentId, agentNom, closedAt, createdAt, updatedAt)
--     type   : 'entree' | 'sortie'
--     statut : 'en_cours' | 'cloture'
--   edl2_photos(id, edlId, pieceId, elementId, name, mime, size, data, createdAt)
--   contenu = ContenuEdl2 : pieces, equipements, compteurs {elec, gaz, eau}, chauffage,
--     eauChaude, proprete, cles, clesPhoto, parties {locataire, locataire2, mandataire,
--     nouvelleAdresse}, constats, remarquesLocataire, photosLibres, edlPrecedent,
--     departAnticipe, finPreavis, devisDemande, signatures, remarques, retenues.
--
-- Écarts entre les deux modèles, et ce qu'en fait l'export :
--   * état « hors service » (absent de Collab) → 'mauvais', observation préfixée ;
--   * état « sans objet » → 'na' ; état non renseigné → '' ;
--   * relevé d'état : edl2 ne connaît qu'entrée et sortie → exporté avec type 'releve',
--     que l'import côté Collab devra accepter ou ignorer ;
--   * terminé et signé → 'cloture' (Collab ne distingue pas) ;
--   * eau chaude : Collab n'a qu'un compteur d'eau → index ajouté aux remarques ;
--   * au-delà de deux locataires : les suivants sont cités dans les remarques ;
--   * tout ce que Collab ne sait pas ranger (bailleur, bail, inventaire réglementaire,
--     empreinte du PDF) est conservé dans contenu.constatio, sans perte.
-- Les photos et signatures sont renvoyées avec leur chemin de stockage ; l'API d'export
-- les convertit en base64 (edl2_photos.data, signatures.png) au moment de l'envoi.
-- =============================================================================

create function private.collab_etat(p public.etat_element) returns text
language sql immutable set search_path = '' as $$
  select case p when 'hors_service' then 'mauvais' when 'sans_objet' then 'na'
                else coalesce(p::text, '') end
$$;

create function private.collab_partie(p_partie uuid) returns jsonb
language sql stable set search_path = '' as $$
  select (select jsonb_build_object('nom', p.nom, 'prenom', p.prenom,
            'email', coalesce(p.email, ''), 'telephone', coalesce(p.telephone, ''),
            'absent', not p.doit_signer)
          from public.edl_parties p where p.id = p_partie)
$$;

create function private.collab_compteur(p_edl uuid, p_type public.compteur_type) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'valeur', coalesce(c.index_1::text, ''), 'verifie', false, 'hc', coalesce(c.index_2::text, ''),
      'numero', coalesce(c.numero, ''), 'reference', '',
      'type', case when c.absent then 'absent' when c.index_1 is not null then 'individuel' else '' end,
      'emplacement', coalesce(c.emplacement, ''),
      'photo', (select ph.id from public.edl_photos ph where ph.compteur_id = c.id order by ph.pris_le limit 1))
    from public.edl_compteurs c where c.edl_id = p_edl and c.type = p_type limit 1),
    jsonb_build_object('valeur', '', 'verifie', false, 'hc', '', 'numero', '', 'reference', '',
                       'type', '', 'emplacement', '', 'photo', null))
$$;

create function private.collab_signature(p_edl uuid, p_partie uuid) returns jsonb
language sql stable set search_path = '' as $$
  select (select jsonb_build_object('nom', trim(p.prenom || ' ' || p.nom), 'png', '',
                                    'le', s.signe_le, 'imagePath', s.image_path)
          from public.edl_signatures s join public.edl_parties p on p.id = s.partie_id
          where s.edl_id = p_edl and s.partie_id = p_partie)
$$;

create function public.export_collab_edl2(p_edl uuid) returns jsonb
language sql stable set search_path = '' as $$
  -- SECURITY INVOKER : les règles RLS de l'appelant s'appliquent.
  with e as (select * from public.edl where id = p_edl),
  loc as (select p.*, row_number() over (order by p.ordre, p.created_at) as rang
          from public.edl_parties p where p.edl_id = p_edl and p.role = 'locataire'),
  mand as (select p.* from public.edl_parties p
           where p.edl_id = p_edl and p.role in ('mandataire_bailleur', 'mandataire_locataire')
           order by p.ordre limit 1),
  vide as (select jsonb_build_object('nom', '', 'prenom', '', 'email', '', 'telephone', '', 'absent', false) as partie)
  select jsonb_build_object(
    'format', 'collab.edl2',
    'version', 2,
    'edl2', jsonb_build_object(
      'id',           coalesce(e.collab_edl_id, e.id::text),
      'type',         case e.type when 'entrant' then 'entree' when 'sortant' then 'sortie' else 'releve' end,
      'statut',       case e.statut when 'brouillon' then 'en_cours' else 'cloture' end,
      'date',         e.date_edl,
      'lotId',        l.collab_lot_id,
      'lotLabel',     l.libelle,
      'adresse',      concat_ws(' ', l.adresse, l.complement, l.code_postal, l.ville),
      'tenantId',     (select collab_tenant_id from loc where rang = 1),
      'locataireNom', coalesce((select string_agg(trim(prenom || ' ' || nom), ', ' order by rang) from loc), ''),
      'entreeId',     (select coalesce(x.collab_edl_id, x.id::text) from public.edl x where x.id = e.entree_id),
      'agentId',      null,
      'agentNom',     e.realise_par_nom,
      'closedAt',     coalesce(e.signe_le, e.genere_le),
      'createdAt',    e.created_at,
      'updatedAt',    e.updated_at,
      'contenu', jsonb_build_object(
        'pieces', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pc.id, 'type', coalesce(pc.type_piece, 'autre'), 'label', pc.nom, 'icone', '',
            'elements', coalesce((select jsonb_agg(jsonb_build_object(
                'id', el.id, 'label', el.libelle, 'icone', '',
                'etat', private.collab_etat(el.etat),
                'observation', concat_ws(' — ',
                    case when el.etat = 'hors_service' then 'Hors service' end,
                    nullif(el.nature, ''), nullif(el.observations, '')),
                'detail', coalesce(el.detail, ''),
                'photos', coalesce((select jsonb_agg(ph.id order by ph.pris_le)
                                    from public.edl_photos ph where ph.element_id = el.id), '[]'))
                order by el.ordre, el.created_at)
              from public.edl_elements el where el.piece_id = pc.id), '[]'))
            order by pc.ordre, pc.created_at) from public.edl_pieces pc where pc.edl_id = e.id), '[]'),
        'equipements', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'nom', i.libelle, 'categorie', 'autre', 'marque', '', 'numeroSerie', '',
            'nombre', i.quantite, 'fonctionne', i.etat is distinct from 'hors_service',
            'etat', private.collab_etat(i.etat), 'observation', coalesce(i.observations, ''), 'photos', '[]'::jsonb)
            order by i.ordre, i.created_at) from public.edl_inventaire i where i.edl_id = e.id), '[]'),
        'compteurs', jsonb_build_object(
            'elec', private.collab_compteur(e.id, 'electricite'),
            'gaz',  private.collab_compteur(e.id, 'gaz'),
            'eau',  private.collab_compteur(e.id, 'eau_froide')),
        'chauffage', jsonb_build_object('modes', '[]'::jsonb, 'releveCollectif', ''),
        'eauChaude', '',
        'proprete', '',
        'cles', coalesce((select jsonb_agg(jsonb_build_object(
            'type', initcap(replace(k.nature::text, 'cle', 'clé')) || ' — ' || k.destination,
            'nombre', k.nombre, 'photo', null) order by k.ordre, k.created_at)
            from public.edl_cles k where k.edl_id = e.id), '[]'),
        'clesPhoto', null,
        'parties', jsonb_build_object(
            'locataire',  coalesce(private.collab_partie((select id from loc where rang = 1)), vide.partie),
            'locataire2', coalesce(private.collab_partie((select id from loc where rang = 2)), vide.partie),
            'mandataire', coalesce((select private.collab_partie(mand.id)
                                      || jsonb_build_object('fonction', '', 'autoriseLe', '',
                                           'represente', case mand.role when 'mandataire_bailleur' then 'bailleur' else 'locataire' end)
                                    from mand),
                                   vide.partie || jsonb_build_object('fonction', '', 'autoriseLe', '', 'represente', '')),
            'nouvelleAdresse', coalesce((select nouvelle_adresse from loc where nouvelle_adresse is not null order by rang limit 1), '')),
        'constats', jsonb_build_object('humidite', false, 'moisissures', false, 'nuisibles', false,
                                       'electriciteOk', false, 'gazOk', false, 'precision', ''),
        'remarquesLocataire', '',
        'photosLibres', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'commentaire', coalesce(ph.legende, '')))
            from public.edl_photos ph
            where ph.edl_id = e.id and ph.piece_id is null and ph.element_id is null and ph.compteur_id is null), '[]'),
        'edlPrecedent', '',
        'departAnticipe', false,
        'finPreavis', '',
        'devisDemande', false,
        'signatures', jsonb_build_object(
            'locataire',  private.collab_signature(e.id, (select id from loc where rang = 1)),
            'locataire2', private.collab_signature(e.id, (select id from loc where rang = 2)),
            'mandataire', private.collab_signature(e.id, (select id from mand)),
            'agent',      private.collab_signature(e.id, (select p.id from public.edl_parties p
                                                          where p.edl_id = e.id and p.role = 'bailleur' order by p.ordre limit 1))),
        'remarques', concat_ws(E'\n',
            nullif(e.remarques_generales, ''),
            (select 'Eau chaude : index ' || c.index_1::text || coalesce(' (compteur n° ' || nullif(c.numero, '') || ')', '')
             from public.edl_compteurs c where c.edl_id = e.id and c.type = 'eau_chaude' and c.index_1 is not null limit 1),
            (select 'Autres locataires : ' || string_agg(trim(prenom || ' ' || nom), ', ' order by rang) from loc where rang > 2)),
        'retenues', coalesce((select jsonb_agg(jsonb_build_object('libelle', r.libelle, 'montant', r.montant_retenu_cents / 100.0)
                                               order by r.created_at)
                              from public.retenues r where r.edl_id = e.id), '[]'),
        -- Ce que Collab ne sait pas ranger, conservé sans perte.
        'constatio', jsonb_build_object(
            'id', e.id, 'type', e.type, 'statut', e.statut, 'pdfSha256', e.pdf_sha256,
            'dateEdlEntree', e.date_edl_entree,
            'bail', jsonb_build_object('type', e.bail_type, 'dateEntree', e.bail_date_entree,
                                       'depotGarantie', e.depot_garantie_cents / 100.0, 'signabailId', e.signabail_bail_id),
            'logement', jsonb_build_object('type', l.type_bien, 'surface', l.surface_m2, 'meuble', l.meuble),
            'bailleurs', coalesce((select jsonb_agg(private.collab_partie(p.id) || jsonb_build_object('adresse', p.adresse) order by p.ordre)
                                   from public.edl_parties p where p.edl_id = e.id and p.role = 'bailleur'), '[]'),
            'inventaireDecret', coalesce((select jsonb_agg(i.code_decret) from public.edl_inventaire i
                                          where i.edl_id = e.id and i.code_decret is not null), '[]'))
      )
    ),
    'edl2_photos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'edlId', coalesce(e.collab_edl_id, e.id::text),
        'pieceId', coalesce(ph.piece_id::text, (select el.piece_id::text from public.edl_elements el where el.id = ph.element_id), ''),
        'elementId', coalesce(ph.element_id::text, ph.compteur_id::text, ''),
        'name', ph.nom, 'mime', ph.mime, 'size', ph.taille,
        'storagePath', ph.storage_path, 'sha256', ph.sha256, 'createdAt', ph.pris_le))
        from public.edl_photos ph where ph.edl_id = e.id), '[]')
  )
  from e
  join public.logements l on l.id = e.logement_id
  cross join vide
$$;

revoke execute on function public.export_collab_edl2(uuid) from public, anon;
grant execute on function public.export_collab_edl2(uuid) to authenticated, service_role;
