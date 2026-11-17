-- Tests des règles d'accès et du cycle de vie. Tout se déroule dans une seule
-- transaction, annulée à la fin : la base reste propre.
\set ON_ERROR_STOP on
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

create function t.connecter(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function t.role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', p_role, true);
end $$;
-- La requête doit lever une erreur.
create function t.refuse(p_nom text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   refusé  : % (%)', p_nom, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : « % » aurait dû être refusé', p_nom;
end $$;
-- La requête doit toucher exactement p_attendu lignes.
create function t.lignes(p_nom text, p_sql text, p_attendu bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> p_attendu then
    raise exception 'ÉCHEC : « % » a touché % ligne(s), attendu %', p_nom, n, p_attendu;
  end if;
  raise notice 'ok   % ligne(s) : %', n, p_nom;
end $$;
create function t.egal(p_nom text, p_obtenu text, p_attendu text) returns void language plpgsql as $$
begin
  if p_obtenu is distinct from p_attendu then
    raise exception 'ÉCHEC : « % » vaut %, attendu %', p_nom, p_obtenu, p_attendu;
  end if;
  raise notice 'ok   % = %', p_nom, p_obtenu;
end $$;

-- Un message « bail signé » tel que Signabail l'enverra.
create function t.bail(p_evt text, p_bail text, p_type text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_evt, 'type', 'bail.signe', 'cree_le', '2026-11-03T16:20:00Z', 'test', false,
    'compte', jsonb_build_object('id', 'sb-42', 'email', 'zzrec-b@example.test'),
    'bail', jsonb_build_object('id', p_bail, 'type', p_type, 'signe_le', '2026-11-03T16:20:00Z', 'date_entree', '2026-11-15', 'depot_garantie', 650.00,
      'logement', jsonb_build_object('adresse', '12 rue des Balances', 'complement', '2e étage', 'code_postal', '34500', 'ville', 'Béziers',
        'type_bien', 'appartement', 'surface_m2', 28.4, 'meuble', p_type = 'meuble', 'pieces', jsonb_build_array('Entrée', 'Séjour', 'Chambre')),
      'bailleur', jsonb_build_object('civilite', 'Mme', 'prenom', 'Claire', 'nom', 'ZZREC Vidal', 'email', 'zzrec-b@example.test'),
      'locataires', jsonb_build_array(jsonb_build_object('prenom', 'Hugo', 'nom', 'ZZREC Marty'), jsonb_build_object('prenom', 'Léa', 'nom', 'ZZREC Roux'))))
$$;

do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';  -- bailleresse
  b uuid := '00000000-0000-4000-a000-00000000000b';  -- autre client, sans lien
  c uuid := '00000000-0000-4000-a000-00000000000c';  -- locataire
  org_a uuid; org_b uuid;
  log uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid();   -- EDL d'entrée, ira jusqu'à la signature
  e2 uuid := gen_random_uuid();   -- brouillon
  p_bail uuid := gen_random_uuid(); p_loc uuid := gen_random_uuid();
  piece uuid := gen_random_uuid(); elem uuid := gen_random_uuid();
  lot_reserve uuid := gen_random_uuid(); lot_libre uuid := gen_random_uuid();
begin
  -- Inscription : profil + organisation + rôle propriétaire créés automatiquement.
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'zzrec-a@example.test', '{"nom":"ZZREC Vidal"}'),
    (b, 'zzrec-b@example.test', '{"nom":"ZZREC Autre"}'),
    (c, 'zzrec-c@example.test', '{"nom":"ZZREC Marty"}');
  select organisation_id into org_a from public.organisation_membres where user_id = a;
  select organisation_id into org_b from public.organisation_membres where user_id = b;
  perform t.egal('organisation créée à l''inscription', (org_a is not null)::text, 'true');

  -- A crée son logement et son EDL --------------------------------------------
  perform t.connecter(a);
  insert into public.logements (id, organisation_id, libelle, adresse, code_postal, ville, surface_m2, meuble)
  values (log, org_a, 'ZZREC T2 Balances', '12 rue des Balances', '34500', 'Béziers', 28, true);
  insert into public.edl (id, organisation_id, logement_id, type) values (e1, org_a, log, 'entrant'), (e2, org_a, log, 'entrant');
  insert into public.edl_parties (id, edl_id, role, nom, user_id) values
    (p_bail, e1, 'bailleur', 'ZZREC Vidal', a), (p_loc, e1, 'locataire', 'ZZREC Marty', c);
  insert into public.edl_pieces (id, edl_id, nom) values (piece, e1, 'Séjour');
  insert into public.edl_elements (id, edl_id, piece_id, categorie, libelle, etat) values (elem, e1, piece, 'sol', 'Sol', 'bon');
  insert into public.edl_compteurs (edl_id, type, numero, double_tarif, index_1, index_2)
  values (e1, 'electricite', '09451302118760', true, 18432, 9877);
  insert into public.edl_cles (edl_id, nature, nombre, destination) values (e1, 'cle', 3, 'porte palière');
  perform t.refuse('élément rattaché à la pièce d''un autre EDL',
    format('insert into public.edl_elements (edl_id, piece_id, categorie, libelle) values (%L, %L, ''sol'', ''Sol'')', e2, piece));
  perform t.refuse('A crée un EDL dans l''organisation de B',
    format('insert into public.edl (organisation_id, logement_id, type) values (%L, %L, ''entrant'')', org_b, log));
  perform t.refuse('A écrit le statut directement',
    format('update public.edl set statut = ''signe'' where id = %L', e1));
  perform t.refuse('A s''attribue des crédits',
    format('insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le) values (%L, ''achat'', 9, 9, now() + interval ''1 year'')', org_a));
  perform t.refuse('finaliser sans crédit', format('select public.edl_finaliser(%L)', e1));

  -- B, client sans lien, ne voit ni ne touche rien -------------------------------
  perform t.connecter(b);
  perform t.lignes('B lit les EDL de A', 'select 1 from public.edl', 0);
  perform t.lignes('B lit les éléments de A', 'select 1 from public.edl_elements', 0);
  perform t.lignes('B modifie un élément de A', format('update public.edl_elements set etat = ''neuf'' where id = %L', elem), 0);
  perform t.refuse('B ajoute une pièce à l''EDL de A', format('insert into public.edl_pieces (edl_id, nom) values (%L, ''Cave'')', e1));
  perform t.refuse('B s''ajoute à l''organisation de A',
    format('insert into public.organisation_membres (organisation_id, user_id, role) values (%L, %L, ''admin'')', org_a, b));
  perform t.refuse('B finalise l''EDL de A', format('select public.edl_finaliser(%L)', e1));
  perform t.egal('B exporte l''EDL de A', public.export_collab_edl2(e1)::text, null);

  -- Le locataire ne voit pas un EDL non signé -----------------------------------
  perform t.connecter(c);
  perform t.lignes('locataire lit l''EDL avant signature', 'select 1 from public.edl', 0);

  -- Crédits : versés par le serveur, consommés à la génération -------------------
  perform t.role('service_role');
  insert into public.credit_lots (id, organisation_id, origine, quantite, restant, type_reserve, expire_le, reference) values
    (lot_reserve, org_a, 'signabail', 1, 1, 'entrant', now() + interval '24 months', 'signabail:bail:ZZREC-1'),
    (lot_libre,   org_a, 'achat',     5, 5, null,      now() + interval '24 months', 'stripe:pi_ZZREC');
  perform t.refuse('même bail Signabail crédité deux fois',
    format('insert into public.credit_lots (organisation_id, origine, quantite, restant, expire_le, reference) values (%L, ''signabail'', 1, 1, now() + interval ''1 year'', ''signabail:bail:ZZREC-1'')', org_a));

  perform t.connecter(a);
  perform public.edl_finaliser(e1);
  perform t.egal('statut après génération', (select statut::text from public.edl where id = e1), 'termine');
  perform t.egal('crédit offert Signabail utilisé en premier', (select restant::text from public.credit_lots where id = lot_reserve), '0');
  perform public.edl_rouvrir(e1);
  perform public.edl_finaliser(e1);
  perform t.egal('rouvrir puis régénérer ne coûte rien', (select restant::text from public.credit_lots where id = lot_libre), '5');
  perform t.refuse('changer le type d''un EDL déjà généré', format('update public.edl set type = ''sortant'' where id = %L', e1));
  perform t.refuse('A marque lui-même l''EDL signé', format('select public.edl_marquer_signe(%L)', e1));
  perform t.refuse('A dépose lui-même une signature',
    format('insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256) values (%L, %L, ''sur_place'', ''abc'')', e1, p_loc));

  -- Signature : par le serveur, et seulement quand tout le monde a signé ---------
  perform t.role('service_role');
  update public.edl set pdf_path = 'x.pdf', pdf_sha256 = 'abc' where id = e1;
  insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256) values (e1, p_bail, 'sur_place', 'abc');
  perform t.refuse('signé alors que le locataire n''a pas signé', format('select public.edl_marquer_signe(%L)', e1));
  insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256) values (e1, p_loc, 'sur_place', 'abc');
  perform public.edl_marquer_signe(e1);
  perform t.egal('statut après signatures', (select statut::text from public.edl where id = e1), 'signe');

  -- Verrou après signature : vaut pour tout le monde, serveur compris -------------
  perform t.refuse('serveur modifie un élément signé', format('update public.edl_elements set etat = ''neuf'' where id = %L', elem));
  perform t.refuse('serveur modifie l''EDL signé', format('update public.edl set remarques_generales = ''x'' where id = %L', e1));
  perform t.refuse('serveur supprime l''EDL signé hors purge', format('delete from public.edl where id = %L', e1));
  perform t.refuse('serveur retire une signature', format('delete from public.edl_signatures where edl_id = %L', e1));
  perform t.refuse('serveur réécrit le journal', format('update public.edl_journal set evenement = ''x'' where edl_id = %L', e1));
  perform t.connecter(a);
  perform t.refuse('A ajoute une photo après signature',
    format('insert into public.edl_photos (edl_id, storage_path, taille, sha256, pris_le) values (%L, ''p'', 1, ''h'', now())', e1));
  perform t.lignes('A fixe le début de la période de chauffe (autorisé)',
    format('update public.edl set debut_periode_chauffe = current_date where id = %L', e1), 1);

  -- Fichiers ---------------------------------------------------------------------
  perform t.refuse('A dépose une photo sur l''EDL signé',
    format('insert into storage.objects (bucket_id, name) values (''edl'', %L)', org_a || '/' || e1 || '/photos/a.jpg'));
  perform t.lignes('A dépose une photo sur son brouillon',
    format('insert into storage.objects (bucket_id, name) values (''edl'', %L)', org_a || '/' || e2 || '/photos/a.jpg'), 1);
  perform t.refuse('A dépose un faux PDF',
    format('insert into storage.objects (bucket_id, name) values (''edl'', %L)', org_a || '/' || e2 || '/pdf/edl.pdf'));
  perform t.connecter(b);
  perform t.refuse('B dépose une photo sur le brouillon de A',
    format('insert into storage.objects (bucket_id, name) values (''edl'', %L)', org_b || '/' || e2 || '/photos/b.jpg'));
  perform t.lignes('B lit les fichiers de A', 'select 1 from storage.objects', 0);

  -- Locataire : lit son EDL signé, peut demander un complément dans les 10 jours ---
  perform t.connecter(c);
  perform t.lignes('locataire lit son EDL signé', 'select 1 from public.edl', 1);
  perform t.lignes('locataire lit les éléments', 'select 1 from public.edl_elements', 1);
  perform t.lignes('locataire lit le journal interne', 'select 1 from public.edl_journal', 0);
  perform t.lignes('locataire demande un complément',
    format('insert into public.edl_complements (edl_id, type, partie_id, texte) values (%L, ''general'', %L, ''Fissure non relevée'')', e1, p_loc), 1);
  perform t.lignes('locataire demande un complément chauffage',
    format('insert into public.edl_complements (edl_id, type, partie_id, texte) values (%L, ''chauffage'', %L, ''Radiateur froid'')', e1, p_loc), 1);
  perform t.connecter(b);
  perform t.refuse('B demande un complément sur l''EDL de A',
    format('insert into public.edl_complements (edl_id, type, partie_id, texte) values (%L, ''general'', %L, ''x'')', e1, p_loc));

  -- Délai de 10 jours dépassé (on recule la date de signature, verrou levé pour le test)
  perform t.role('none');
  alter table public.edl disable trigger edl_verrou;
  update public.edl set signe_le = now() - interval '11 days' where id = e1;
  alter table public.edl enable trigger edl_verrou;
  perform t.connecter(c);
  perform t.refuse('complément après 10 jours',
    format('insert into public.edl_complements (edl_id, type, partie_id, texte) values (%L, ''general'', %L, ''trop tard'')', e1, p_loc));

  -- Export Collab ---------------------------------------------------------------
  perform t.connecter(a);
  perform t.egal('export : type Collab', public.export_collab_edl2(e1) #>> '{edl2,type}', 'entree');
  perform t.egal('export : signé → cloture', public.export_collab_edl2(e1) #>> '{edl2,statut}', 'cloture');
  perform t.egal('export : brouillon → en_cours', public.export_collab_edl2(e2) #>> '{edl2,statut}', 'en_cours');
  perform t.egal('export : locataire', public.export_collab_edl2(e1) #>> '{edl2,locataireNom}', 'ZZREC Marty');
  perform t.egal('export : partie locataire', public.export_collab_edl2(e1) #>> '{edl2,contenu,parties,locataire,nom}', 'ZZREC Marty');
  perform t.egal('export : libellé de la pièce', public.export_collab_edl2(e1) #>> '{edl2,contenu,pieces,0,label}', 'Séjour');
  perform t.egal('export : état du sol', public.export_collab_edl2(e1) #>> '{edl2,contenu,pieces,0,elements,0,etat}', 'bon');
  perform t.egal('export : index électricité', public.export_collab_edl2(e1) #>> '{edl2,contenu,compteurs,elec,valeur}', '18432.000');
  perform t.egal('export : heures creuses', public.export_collab_edl2(e1) #>> '{edl2,contenu,compteurs,elec,hc}', '9877.000');
  perform t.egal('export : compteur de gaz non saisi', public.export_collab_edl2(e1) #>> '{edl2,contenu,compteurs,gaz,type}', '');
  perform t.egal('export : clés', public.export_collab_edl2(e1) #>> '{edl2,contenu,cles,0,type}', 'Clé — porte palière');
  perform t.egal('export : signature du locataire', (public.export_collab_edl2(e1) #>> '{edl2,contenu,signatures,locataire,nom}'), 'ZZREC Marty');
  perform t.egal('export : hors service → mauvais', private.collab_etat('hors_service'), 'mauvais');
  perform t.egal('export : sans objet → na', private.collab_etat('sans_objet'), 'na');

  -- Prestation sur place : plafond légal de la part locataire ------------------------
  perform t.role('service_role');
  perform t.lignes('réservation 28 m², part locataire 84 €',
    format('insert into public.reservations (organisation_id, type, secteur, adresse, code_postal, ville, surface_m2, creneau, contact_nom, contact_telephone, montant_cents, part_locataire_cents) values (%L, ''entrant'', ''beziers'', ''x'', ''34500'', ''Béziers'', 28, now(), ''ZZREC'', ''0600000000'', 18000, 8400)', org_a), 1);
  perform t.refuse('part locataire au-dessus de 3 €/m²',
    format('insert into public.reservations (organisation_id, type, secteur, adresse, code_postal, ville, surface_m2, creneau, contact_nom, contact_telephone, montant_cents, part_locataire_cents) values (%L, ''entrant'', ''beziers'', ''x'', ''34500'', ''Béziers'', 28, now(), ''ZZREC'', ''0600000000'', 18000, 8500)', org_a));
  perform t.refuse('part locataire supérieure à celle du bailleur',
    format('insert into public.reservations (organisation_id, type, secteur, adresse, code_postal, ville, surface_m2, creneau, contact_nom, contact_telephone, montant_cents, part_locataire_cents) values (%L, ''entrant'', ''beziers'', ''x'', ''34500'', ''Béziers'', 80, now(), ''ZZREC'', ''0600000000'', 18000, 9100)', org_a));
  perform t.refuse('EDL de sortie facturé au locataire',
    format('insert into public.reservations (organisation_id, type, secteur, adresse, code_postal, ville, surface_m2, creneau, contact_nom, contact_telephone, montant_cents, part_locataire_cents) values (%L, ''sortant'', ''beziers'', ''x'', ''34500'', ''Béziers'', 28, now(), ''ZZREC'', ''0600000000'', 18000, 100)', org_a));

  -- Décompte : délai de restitution -------------------------------------------------
  insert into public.decomptes (edl_id, depot_cents, total_retenues_cents, conforme, date_remise_cles)
  values (e2, 65000, 20571, false, date '2026-11-17');
  perform t.egal('décompte : à restituer', (select a_restituer_cents::text from public.decomptes where edl_id = e2), '44429');
  perform t.egal('décompte : 2 mois si non conforme', (select date_limite::text from public.decomptes where edl_id = e2), '2027-01-17');

  -- Signabail : crédit offert et brouillon pré-rempli --------------------------------
  perform t.role('service_role');
  perform t.egal('bail signé, client pas encore inscrit', public.signabail_recevoir(t.bail('evt-1', 'bail-A', 'meuble')), 'en_attente');
  perform t.egal('en attente : aucun crédit versé', (select count(*)::text from public.credit_lots where organisation_id = org_b), '0');
  perform t.egal('rattachement : le message en attente est traité', public.signabail_rattacher(org_b, 'sb-42')::text, '1');
  perform t.egal('1 crédit offert, réservé à l''entrée',
    (select quantite || ' ' || type_reserve || ' ' || origine from public.credit_lots where reference = 'signabail:bail:bail-A'), '1 entrant signabail');
  perform t.egal('crédit valable 24 mois après la signature du bail',
    (select expire_le::date::text from public.credit_lots where reference = 'signabail:bail:bail-A'), '2028-11-03');
  perform t.egal('brouillon d''entrée créé depuis le bail',
    (select type || ' ' || statut || ' ' || bail_type || ' ' || depot_garantie_cents from public.edl where signabail_bail_id = 'bail-A'), 'entrant brouillon meuble 65000');
  perform t.egal('parties reprises', (select string_agg(role || ':' || nom, ', ' order by ordre) from public.edl_parties p
    join public.edl e on e.id = p.edl_id where e.signabail_bail_id = 'bail-A'), 'bailleur:ZZREC Vidal, locataire:ZZREC Marty, locataire:ZZREC Roux');
  perform t.egal('pièces reprises dans l''ordre', (select string_agg(nom, ', ' order by ordre) from public.edl_pieces p
    join public.edl e on e.id = p.edl_id where e.signabail_bail_id = 'bail-A'), 'Entrée, Séjour, Chambre');
  perform t.egal('même message reçu deux fois', public.signabail_recevoir(t.bail('evt-1', 'bail-A', 'meuble')), 'deja_recu');
  perform t.egal('même bail dans un autre message', public.signabail_recevoir(t.bail('evt-2', 'bail-A', 'meuble')), 'traite');
  perform t.egal('toujours un seul crédit et un seul brouillon',
    (select count(*) from public.credit_lots where organisation_id = org_b)::text || ' ' || (select count(*) from public.edl where signabail_bail_id = 'bail-A')::text, '1 1');
  perform t.egal('second bail à la même adresse : logement réutilisé', public.signabail_recevoir(t.bail('evt-3', 'bail-B', 'vide')), 'traite');
  perform t.egal('un seul logement pour les deux baux', (select count(*)::text from public.logements where organisation_id = org_b), '1');
  perform t.egal('bail de garage : pas d''EDL offert', public.signabail_recevoir(t.bail('evt-4', 'bail-C', 'garage')), 'sans_offre');
  perform t.egal('garage : ni crédit ni brouillon',
    (select count(*) from public.credit_lots where reference = 'signabail:bail:bail-C')::text || ' ' || (select count(*) from public.edl where signabail_bail_id = 'bail-C')::text, '0 0');
  perform t.egal('bail annulé', public.signabail_recevoir(jsonb_build_object('id', 'evt-5', 'type', 'bail.annule', 'compte', jsonb_build_object('id', 'sb-42'), 'bail', jsonb_build_object('id', 'bail-B'))), 'traite');
  perform t.egal('annulation : crédit inutilisé retiré, brouillon gardé',
    (select count(*) from public.credit_lots where reference = 'signabail:bail:bail-B')::text || ' ' || (select count(*) from public.edl where signabail_bail_id = 'bail-B')::text, '0 1');
  perform t.egal('offre groupée', public.signabail_recevoir(jsonb_build_object('id', 'evt-6', 'type', 'offre_groupee.achetee', 'compte', jsonb_build_object('id', 'sb-42'), 'offre', jsonb_build_object('id', 'og-1'))), 'traite');
  perform t.egal('offre groupée : un crédit d''entrée et un de sortie',
    (select string_agg(type_reserve::text, ', ' order by type_reserve) from public.credit_lots where reference like 'signabail:groupe:og-1:%'), 'entrant, sortant');
  perform t.egal('bail d''une offre groupée : pas de crédit offert en plus',
    public.signabail_recevoir(t.bail('evt-7', 'bail-D', 'vide') || '{"offre_groupee": true}'), 'traite');
  perform t.egal('offre groupée : brouillon oui, crédit non',
    (select count(*) from public.credit_lots where reference = 'signabail:bail:bail-D')::text || ' ' || (select count(*) from public.edl where signabail_bail_id = 'bail-D')::text, '0 1');
  perform t.egal('message de test sur un compte réel : ignoré', public.signabail_recevoir(t.bail('evt-8', 'bail-E', 'vide') || '{"test": true}'), 'ignore_test');
  perform t.egal('test ignoré : rien créé', (select count(*)::text from public.edl where signabail_bail_id = 'bail-E'), '0');
  perform t.refuse('message incomplet', 'select public.signabail_recevoir(''{"type": "bail.signe"}'')');
  perform t.connecter(b);
  perform t.refuse('un client fabrique lui-même un message Signabail', format('select public.signabail_recevoir(%L)', t.bail('evt-9', 'bail-F', 'vide')));
  perform t.refuse('un client se rattache lui-même à un compte Signabail', format('select public.signabail_rattacher(%L, ''sb-99'')', org_b));
  perform t.lignes('le client voit ses brouillons reçus de Signabail', 'select 1 from public.edl where source = ''signabail''', 3);
  perform t.refuse('le client lit les messages reçus de Signabail', 'select 1 from public.webhook_evenements');
  perform t.connecter(a);
  perform t.lignes('un autre client ne voit rien de tout cela', 'select 1 from public.edl where source = ''signabail''', 0);

  -- Visiteur non connecté -------------------------------------------------------------
  perform t.role('anon');
  perform t.lignes('visiteur lit les tarifs', 'select code from public.tarifs', 8);
  perform t.refuse('visiteur lit les EDL', 'select 1 from public.edl');
  perform t.refuse('visiteur lit les identifiants Stripe des tarifs', 'select stripe_price_id from public.tarifs');

  -- Purge RGPD ---------------------------------------------------------------------
  perform t.role('service_role');
  perform set_config('app.purge', 'on', true);
  perform t.lignes('purge d''un EDL signé', format('delete from public.edl where id = %L', e1), 1);
  perform t.role('none');
  perform t.egal('purge : plus aucun élément', (select count(*)::text from public.edl_elements where edl_id = e1), '0');
  perform t.egal('purge : journal emporté', (select count(*)::text from public.edl_journal where edl_id = e1), '0');
end $$;

rollback;
\echo TOUS LES TESTS PASSENT
