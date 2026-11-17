-- =============================================================================
-- Constatio — 5/5 : export au format des tables Collab
-- -----------------------------------------------------------------------------
-- Tables EDL de Collab relevées le 17/11/2026 (vides à cette date) :
--   edl2(id, type, statut, date, lotId, lotLabel, adresse, tenantId,
--        locataireNom, entreeId, contenu jsonb, agentId, agentNom, closedAt,
--        createdAt, updatedAt)                    statut par défaut : 'en_cours'
--   edl2_photos(id, edlId, pieceId, elementId, name, mime, size, data, createdAt)
--   etats_des_lieux(id, type, date, lotId, tenantId, compteurElec, compteurGaz,
--        compteurEau, nbCles, pieces text, remarques, depositedAt, …)  ancien module
--
-- HYPOTHÈSES à confirmer sur un EDL réel de Collab (les tables étant vides, la
-- forme de « contenu » et les valeurs de type/statut n'ont pas pu être lues) :
--   * type   : 'entrant' | 'sortant' | 'releve' ;
--   * statut : brouillon → 'en_cours', terminé → 'termine', signé → 'signe' ;
--   * contenu : structure ci-dessous, versionnée (« version »: 1) pour pouvoir
--     l'ajuster sans casser les exports déjà faits.
-- Les photos sont renvoyées avec leur chemin de stockage ; l'API d'export les
-- convertit en base64 (edl2_photos.data) au moment de l'envoi.
-- =============================================================================

create function public.export_collab_edl2(p_edl uuid) returns jsonb
language sql stable set search_path = '' as $$
  -- SECURITY INVOKER : les règles RLS de l'appelant s'appliquent.
  select jsonb_build_object(
    'format', 'collab.edl2',
    'version', 1,
    'edl2', jsonb_build_object(
      'id',           coalesce(e.collab_edl_id, e.id::text),
      'type',         e.type,
      'statut',       case e.statut when 'brouillon' then 'en_cours' when 'termine' then 'termine' else 'signe' end,
      'date',         e.date_edl,
      'lotId',        l.collab_lot_id,
      'lotLabel',     l.libelle,
      'adresse',      concat_ws(' ', l.adresse, l.complement, l.code_postal, l.ville),
      'tenantId',     (select p.collab_tenant_id from public.edl_parties p
                       where p.edl_id = e.id and p.role = 'locataire' order by p.ordre limit 1),
      'locataireNom', coalesce((select string_agg(trim(p.prenom || ' ' || p.nom), ', ' order by p.ordre)
                       from public.edl_parties p where p.edl_id = e.id and p.role = 'locataire'), ''),
      'entreeId',     (select coalesce(x.collab_edl_id, x.id::text) from public.edl x where x.id = e.entree_id),
      'agentId',      null,
      'agentNom',     e.realise_par_nom,
      'closedAt',     coalesce(e.signe_le, e.genere_le),
      'createdAt',    e.created_at,
      'updatedAt',    e.updated_at,
      'contenu', jsonb_build_object(
        'version', 1,
        'source', 'constatio',
        'constatioId', e.id,
        'bail', jsonb_build_object('type', e.bail_type, 'dateEntree', e.bail_date_entree,
                                   'depotGarantie', e.depot_garantie_cents / 100.0,
                                   'signabailId', e.signabail_bail_id),
        'logement', jsonb_build_object('type', l.type_bien, 'surface', l.surface_m2, 'meuble', l.meuble),
        'dateEdlEntree', e.date_edl_entree,
        'parties', coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'role', p.role, 'representeId', p.represente_id, 'civilite', p.civilite,
            'prenom', p.prenom, 'nom', p.nom, 'email', p.email, 'telephone', p.telephone,
            'adresse', p.adresse, 'nouvelleAdresse', p.nouvelle_adresse, 'tenantId', p.collab_tenant_id)
            order by p.ordre) from public.edl_parties p where p.edl_id = e.id), '[]'),
        'pieces', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pc.id, 'zone', pc.zone, 'nom', pc.nom, 'type', pc.type_piece, 'observations', pc.observations,
            'elements', coalesce((select jsonb_agg(jsonb_build_object(
                'id', el.id, 'categorie', el.categorie, 'libelle', el.libelle, 'nature', el.nature,
                'etat', el.etat, 'fonctionne', el.fonctionne, 'quantite', el.quantite,
                'observations', el.observations) order by el.ordre)
              from public.edl_elements el where el.piece_id = pc.id), '[]'))
            order by pc.ordre) from public.edl_pieces pc where pc.edl_id = e.id), '[]'),
        'compteurs', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'type', c.type, 'absent', c.absent, 'numero', c.numero, 'doubleTarif', c.double_tarif,
            'index1', c.index_1, 'index2', c.index_2, 'emplacement', c.emplacement,
            'observations', c.observations)) from public.edl_compteurs c where c.edl_id = e.id), '[]'),
        'cles', coalesce((select jsonb_agg(jsonb_build_object(
            'nature', k.nature, 'nombre', k.nombre, 'destination', k.destination,
            'observations', k.observations) order by k.ordre)
            from public.edl_cles k where k.edl_id = e.id), '[]'),
        'inventaire', coalesce((select jsonb_agg(jsonb_build_object(
            'libelle', i.libelle, 'codeDecret', i.code_decret, 'quantite', i.quantite, 'etat', i.etat,
            'observations', i.observations, 'pieceId', i.piece_id) order by i.ordre)
            from public.edl_inventaire i where i.edl_id = e.id), '[]'),
        'remarques', e.remarques_generales,
        'signatures', coalesce((select jsonb_agg(jsonb_build_object(
            'partieId', s.partie_id, 'mode', s.mode, 'signeLe', s.signe_le, 'pdfSha256', s.pdf_sha256))
            from public.edl_signatures s where s.edl_id = e.id), '[]'),
        'pdfSha256', e.pdf_sha256
      )
    ),
    'edl2_photos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'edlId', coalesce(e.collab_edl_id, e.id::text),
        'pieceId', coalesce(ph.piece_id::text, (select el.piece_id::text from public.edl_elements el where el.id = ph.element_id), ''),
        'elementId', coalesce(ph.element_id::text, ph.compteur_id::text, ''),
        'name', ph.nom, 'mime', ph.mime, 'size', ph.taille,
        'storagePath', ph.storage_path, 'sha256', ph.sha256, 'prisLe', ph.pris_le,
        'latitude', ph.latitude, 'longitude', ph.longitude, 'createdAt', ph.created_at))
        from public.edl_photos ph where ph.edl_id = e.id), '[]'),
    -- Ancien module de Collab : résumé à plat.
    'etats_des_lieux', jsonb_build_object(
      'id', e.id, 'type', e.type, 'date', e.date_edl, 'lotId', l.collab_lot_id,
      'compteurElec', (select concat_ws(' / ', c.index_1::text, c.index_2::text) from public.edl_compteurs c
                       where c.edl_id = e.id and c.type = 'electricite' limit 1),
      'compteurGaz',  (select c.index_1::text from public.edl_compteurs c
                       where c.edl_id = e.id and c.type = 'gaz' limit 1),
      'compteurEau',  (select c.index_1::text from public.edl_compteurs c
                       where c.edl_id = e.id and c.type = 'eau_froide' limit 1),
      'nbCles', (select coalesce(sum(k.nombre), 0) from public.edl_cles k where k.edl_id = e.id),
      'remarques', e.remarques_generales,
      'createdByName', e.realise_par_nom
    )
  )
  from public.edl e
  join public.logements l on l.id = e.logement_id
  where e.id = p_edl
$$;

revoke execute on function public.export_collab_edl2(uuid) from public, anon;
grant execute on function public.export_collab_edl2(uuid) to authenticated, service_role;
