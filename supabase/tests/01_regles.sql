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
  -- Terminé = figé : le document généré doit rester fidèle aux données ------------
  perform t.refuse('A dépose lui-même le PDF', format('select public.edl_deposer_pdf(%L, %L, %L, %L, 1, 10)', e1, org_a || '/' || e1 || '/pdf/a.pdf', repeat('a', 64), a));
  perform t.egal('A ne peut plus modifier un élément terminé', (select private.edl_modifiable(e1))::text, 'false');
  perform t.role('service_role');
  perform t.refuse('élément modifié sur un EDL terminé', format('update public.edl_elements set etat = ''neuf'' where id = %L', elem));
  perform t.refuse('remarques modifiées sur un EDL terminé', format('update public.edl set remarques_generales = ''x'' where id = %L', e1));
  perform t.refuse('PDF déposé hors du dossier de l''EDL', format('select public.edl_deposer_pdf(%L, %L, %L, %L, 1, 10)', e1, org_a || '/autre/pdf/a.pdf', repeat('a', 64), a));
  perform t.refuse('PDF déposé avec une empreinte invalide', format('select public.edl_deposer_pdf(%L, %L, %L, %L, 1, 10)', e1, org_a || '/' || e1 || '/pdf/a.pdf', 'abc', a));
  perform public.edl_deposer_pdf(e1, org_a || '/' || e1 || '/pdf/a.pdf', repeat('a', 64), a, 3, 1000);
  perform t.egal('empreinte du PDF conservée', (select pdf_sha256 from public.edl where id = e1), repeat('a', 64));
  perform t.egal('dépôt du PDF journalisé', (select count(*)::text from public.edl_journal where edl_id = e1 and evenement = 'pdf_genere'), '1');
  perform t.connecter(a);
  perform public.edl_rouvrir(e1);
  perform t.egal('rouvert : l''empreinte est effacée', coalesce((select pdf_sha256 from public.edl where id = e1), 'aucune'), 'aucune');
  perform t.egal('rouvert : de nouveau modifiable', (select private.edl_modifiable(e1))::text, 'true');
  perform public.edl_finaliser(e1);
  perform t.egal('seconde correction, toujours sans crédit', (select restant::text from public.credit_lots where id = lot_libre), '5');
  perform t.refuse('changer le type d''un EDL déjà généré', format('update public.edl set type = ''sortant'' where id = %L', e1));
  perform t.refuse('A signe lui-même par la base', format('select public.edl_signer(%L, %L, ''sur_place'', null, null, ''x'')', e1, p_loc));
  perform t.refuse('A clôt lui-même les signatures', format('select public.edl_cloturer_signatures(%L, %L, %L)', e1, org_a || '/' || e1 || '/pdf/s.pdf', repeat('b', 64)));
  perform t.refuse('A dépose lui-même une signature',
    format('insert into public.edl_signatures (edl_id, partie_id, mode, pdf_sha256) values (%L, %L, ''sur_place'', ''abc'')', e1, p_loc));

  -- Signature : par le serveur, sur le document généré, et close quand tous ont signé --
  perform t.role('service_role');
  perform t.refuse('signature avant que le document existe', format('select public.edl_signer(%L, %L, ''sur_place'', null, null, ''x'')', e1, p_bail));
  perform public.edl_deposer_pdf(e1, org_a || '/' || e1 || '/pdf/b.pdf', repeat('c', 64), a, 3, 1000);
  perform t.egal('bailleur signe sur place : il en reste', public.edl_signer(e1, p_bail, 'sur_place', null, '203.0.113.7', 'Téléphone de test', a)::text, '1');
  perform t.refuse('le bailleur signe deux fois', format('select public.edl_signer(%L, %L, ''sur_place'', null, null, ''x'')', e1, p_bail));
  perform t.refuse('clôture alors que le locataire n''a pas signé', format('select public.edl_cloturer_signatures(%L, %L, %L)', e1, org_a || '/' || e1 || '/pdf/s.pdf', repeat('b', 64)));
  perform t.refuse('document remplacé après une signature', format('select public.edl_deposer_pdf(%L, %L, %L, %L, 1, 10)', e1, org_a || '/' || e1 || '/pdf/z.pdf', repeat('d', 64), a));
  perform t.refuse('signature à distance sans lien', format('select public.edl_signer(%L, %L, ''a_distance'', null, null, ''x'', null, ''inconnu'')', e1, p_loc));
  perform public.edl_creer_jeton_signature(e1, p_loc, 'hash-1', a);
  perform public.edl_creer_jeton_signature(e1, p_loc, 'hash-2', a);
  perform t.refuse('un lien remplacé ne vaut plus', format('select public.edl_signer(%L, %L, ''a_distance'', null, null, ''x'', null, ''hash-1'')', e1, p_loc));
  perform t.refuse('lien d''une autre personne', format('select public.edl_signer(%L, %L, ''a_distance'', null, null, ''x'', null, ''hash-2'')', e1, p_bail));
  perform t.refuse('lien déjà signé pour le bailleur', format('select public.edl_creer_jeton_signature(%L, %L, ''hash-3'', %L)', e1, p_bail, a));
  perform t.connecter(a);
  perform t.refuse('rouvrir après une signature', format('select public.edl_rouvrir(%L)', e1));
  perform t.refuse('A lit les liens de signature', 'select * from public.edl_jetons');
  perform t.role('service_role');
  perform t.egal('locataire signe à distance : plus personne', public.edl_signer(e1, p_loc, 'a_distance', null, '198.51.100.4', 'Navigateur', null, 'hash-2')::text, '0');
  perform t.refuse('le lien ne sert qu''une fois', format('select public.edl_signer(%L, %L, ''a_distance'', null, null, ''x'', null, ''hash-2'')', e1, p_loc));
  perform t.refuse('exemplaire signé hors du dossier', format('select public.edl_cloturer_signatures(%L, %L, %L)', e1, 'ailleurs/pdf/s.pdf', repeat('b', 64)));
  perform public.edl_cloturer_signatures(e1, org_a || '/' || e1 || '/pdf/s.pdf', repeat('b', 64));
  perform t.egal('exemplaire signé conservé', (select pdf_signe_sha256 from public.edl where id = e1), repeat('b', 64));
  perform t.egal('journal : deux signatures', (select count(*)::text from public.edl_journal where edl_id = e1 and evenement = 'signature'), '2');
  perform t.egal('statut après signatures', (select statut::text from public.edl where id = e1), 'signe');

  -- Réserves du locataire (dix jours après l'état des lieux d'entrée signé) ---------------
  perform t.connecter(b);
  perform t.refuse('un autre compte crée un lien de réserves', format('select public.reserves_lien(%L, %L, %L)', e1, p_loc, encode(sha256('res-1'), 'hex')));
  perform t.connecter(a);
  perform t.refuse('lien de réserves sur un brouillon', format('select public.reserves_lien(%L, %L, %L)', e2, p_loc, encode(sha256('res-0'), 'hex')));
  perform public.reserves_lien(e1, p_loc, encode(sha256('res-1'), 'hex'));
  -- Le bailleur aussi a son lien : il y retrouve le document, sans pouvoir déposer.
  perform t.egal('lien du bailleur : pas de dépôt', coalesce(public.reserves_lien(e1, p_bail, encode(sha256('res-0'), 'hex'))::text, 'aucun'), 'aucun');
  perform t.role('anon');
  perform t.egal('le bailleur consulte', (public.reserves_consulter('res-0') ->> 'ouvert'), 'false');
  perform t.refuse('le bailleur ne dépose pas de réserve', $q$select public.reserves_deposer('res-0', 'Je me réserve le droit')$q$);
  -- Photos : seulement dans le dossier de son propre lien.
  perform t.refuse('photo hors de son dossier', format($q$insert into storage.objects (bucket_id, name) values ('edl', %L)$q$, org_a || '/' || e1 || '/photos/' || gen_random_uuid() || '.jpg'));
  perform t.refuse('photo dans le dossier du bailleur', format($q$insert into storage.objects (bucket_id, name) values ('edl', %L)$q$, org_a || '/' || e1 || '/reserves/' || encode(sha256('res-0'), 'hex') || '/' || gen_random_uuid() || '.jpg'));
  perform set_config('t.photo', org_a || '/' || e1 || '/reserves/' || encode(sha256('res-1'), 'hex') || '/' || gen_random_uuid() || '.jpg', false);
  insert into storage.objects (bucket_id, name) values ('edl', current_setting('t.photo'));
  perform t.refuse('photo jamais envoyée', format($q$select public.reserves_deposer('res-1', 'Tache au mur du séjour', null, array[%L])$q$, replace(current_setting('t.photo'), '.jpg', '0.jpg')));
  perform t.refuse('pièce d''un autre état des lieux', format($q$select public.reserves_deposer('res-1', 'Tache au mur du séjour', %L)$q$, gen_random_uuid()));
  perform public.reserves_deposer('res-1', 'Tache au mur du séjour, avec photo.', (public.reserves_consulter('res-1') #>> '{pieces,0,id}')::uuid, array[current_setting('t.photo')]);
  perform t.egal('réserve rattachée à sa pièce', ((public.reserves_consulter('res-1') #>> '{reserves,0,piece}') is not null)::text, 'true');
  perform t.egal('réserve avec photo', (public.reserves_consulter('res-1') #>> '{reserves,0,photos,0}'), current_setting('t.photo'));
  perform t.role('postgres');
  delete from public.edl_complements where edl_id = e1;
  perform t.connecter(a);
  perform t.role('anon');
  perform t.egal('le locataire voit de quel logement il s''agit', (public.reserves_consulter('res-1') ->> 'ouvert'), 'true');
  perform t.egal('lien inconnu : rien', coalesce(public.reserves_consulter('res-faux')::text, 'rien'), 'rien');
  perform t.refuse('réserve vide', $q$select public.reserves_deposer('res-1', '  ')$q$);
  perform t.refuse('réserve avec un faux lien', $q$select public.reserves_deposer('res-faux', 'Fissure au plafond du séjour')$q$);
  perform public.reserves_deposer('res-1', 'Fissure au plafond du séjour, non notée.');
  perform t.egal('la réserve attend la réponse du bailleur', (public.reserves_consulter('res-1') #>> '{reserves,0,statut}'), 'demande');
  perform t.connecter(a);
  perform set_config('t.reserve', (select id::text from public.edl_complements where edl_id = e1 limit 1), true);
  perform t.role('anon');
  perform t.refuse('le locataire répond à sa propre réserve', format('select public.reserves_repondre(%L, true, ''ok'')', current_setting('t.reserve')));
  perform t.connecter(b);
  perform t.lignes('un autre compte ne voit pas la réserve', 'select 1 from public.edl_complements', 0);
  perform t.refuse('un autre compte y répond', format('select public.reserves_repondre(%L, true, ''ok'')', current_setting('t.reserve')));
  perform t.connecter(a);
  perform public.reserves_repondre(current_setting('t.reserve')::uuid, true, 'Constaté lors de ma visite du lendemain.');
  perform t.role('anon');
  perform t.egal('le locataire lit la décision', (public.reserves_consulter('res-1') #>> '{reserves,0,statut}') || ' ' || (public.reserves_consulter('res-1') #>> '{reserves,0,reponse}'), 'accepte Constaté lors de ma visite du lendemain.');
  -- Onzième jour : plus de réserve possible.
  perform t.role('postgres');
  update public.edl_jetons set depot_jusqu_au = now() - interval '1 minute' where usage = 'complement' and depot_jusqu_au is not null;
  perform t.role('anon');
  perform t.refuse('réserve après le dixième jour', $q$select public.reserves_deposer('res-1', 'Trop tard, robinet qui goutte')$q$);
  perform t.egal('le lien reste lisible, mais fermé', (public.reserves_consulter('res-1') ->> 'ouvert'), 'false');
  perform t.refuse('plus de photo après le dixième jour', format($q$insert into storage.objects (bucket_id, name) values ('edl', %L)$q$, replace(current_setting('t.photo'), '.jpg', 'a.jpg')));
  perform t.role('service_role');


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
  perform t.role('none');
  alter table public.edl_elements disable trigger edl_elements_verrou;
  update public.edl_elements set fonctionne = false, observations = 'Sangle effilochée' where id = elem;
  alter table public.edl_elements enable trigger edl_elements_verrou;
  perform t.connecter(a);
  perform t.egal('export : « ne fonctionne pas » en tête d''observation',
    public.export_collab_edl2(e1) #>> '{edl2,contenu,pieces,0,elements,0,observation}', 'Ne fonctionne pas — Sangle effilochée');
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
  -- Le message tel que Signabail l'envoie réellement : « bail.genere », nombre de pièces, mandataire.
  perform t.egal('bail généré (format Signabail)', public.signabail_recevoir(jsonb_build_object('id', 'signabail-bail-G', 'type', 'bail.genere', 'test', false,
    'compte', jsonb_build_object('id', 'sb-42'),
    'bail', jsonb_build_object('id', 'G', 'type', 'vide', 'genere_le', '2026-11-10T09:00:00Z', 'signe_le', null, 'date_entree', '2026-12-01', 'depot_garantie', null,
      'logement', jsonb_build_object('adresse', '5 rue Neuve', 'complement', null, 'code_postal', '11000', 'ville', 'Carcassonne', 'type_bien', 'maison', 'surface_m2', 92, 'nb_pieces', 4, 'meuble', false),
      'bailleur', jsonb_build_object('prenom', '', 'nom', 'M. Paul ZZREC Roux'),
      'co_bailleurs', jsonb_build_array(jsonb_build_object('prenom', 'Anne', 'nom', 'ZZREC Roux')),
      'mandataire', jsonb_build_object('prenom', '', 'nom', 'ZZREC LOTIER', 'adresse', '40 rue Française, 34500 Béziers'),
      'locataires', jsonb_build_array(jsonb_build_object('prenom', 'Léa', 'nom', 'ZZREC Petit'))))), 'traite');
  perform t.egal('bail généré : crédit valable 24 mois après la génération',
    (select expire_le::date::text from public.credit_lots where reference = 'signabail:bail:G'), '2028-11-10');
  perform t.egal('bail généré : nombre de pièces gardé, aucune pièce créée par le serveur',
    (select l.nb_pieces::text || ' ' || l.type_bien || ' ' || (select count(*) from public.edl_pieces p where p.edl_id = e.id)
     from public.edl e join public.logements l on l.id = e.logement_id where e.signabail_bail_id = 'G'), '4 maison 0');
  perform t.egal('bail généré : bailleurs, mandataire rattaché au premier bailleur, locataire',
    (select string_agg(p.role || ':' || p.nom || coalesce('>' || r.nom, ''), ', ' order by p.ordre) from public.edl_parties p
     left join public.edl_parties r on r.id = p.represente_id join public.edl e on e.id = p.edl_id where e.signabail_bail_id = 'G'),
    'bailleur:M. Paul ZZREC Roux, bailleur:ZZREC Roux, mandataire_bailleur:ZZREC LOTIER>M. Paul ZZREC Roux, locataire:ZZREC Petit');
  perform t.egal('recherche d''un compte par adresse, sans tenir compte de la casse', public.utilisateur_par_email(' ZZREC-B@example.test ')::text, b::text);
  perform t.egal('adresse inconnue', public.utilisateur_par_email('personne@example.test')::text, null);
  perform t.refuse('message incomplet', 'select public.signabail_recevoir(''{"type": "bail.signe"}'')');
  perform t.connecter(b);
  perform t.refuse('un client fabrique lui-même un message Signabail', format('select public.signabail_recevoir(%L)', t.bail('evt-9', 'bail-F', 'vide')));
  perform t.refuse('un client cherche si une adresse a un compte', 'select public.utilisateur_par_email(''zzrec-a@example.test'')');
  perform t.refuse('un client se rattache lui-même à un compte Signabail', format('select public.signabail_rattacher(%L, ''sb-99'')', org_b));
  perform t.lignes('le client voit ses brouillons reçus de Signabail', 'select 1 from public.edl where source = ''signabail''', 4);
  perform t.refuse('le client lit les messages reçus de Signabail', 'select 1 from public.webhook_evenements');
  perform t.connecter(a);
  perform t.lignes('un autre client ne voit rien de tout cela', 'select 1 from public.edl where source = ''signabail''', 0);

  -- Administration -----------------------------------------------------------------
  perform t.connecter(a);
  perform t.egal('un client n''a aucun rôle d''administration', public.admin_moi(), null);
  perform t.refuse('un client lit le tableau de bord', 'select public.admin_tableau_de_bord()');
  perform t.refuse('un client liste les comptes', 'select public.admin_comptes()');
  perform t.refuse('un client lit le détail d''un autre compte', format('select public.admin_compte(%L)', org_b));
  perform t.refuse('un client s''offre des crédits', format('select public.admin_offrir_credits(%L, 5, ''pour moi'')', org_a));
  perform t.refuse('un client change un tarif', 'select public.admin_modifier_tarif(''edl_unite'', 1, 1, true, ''x'')');
  perform t.refuse('un client coupe le mode test', 'select public.admin_mode_test(false)');
  perform t.refuse('un client lit le journal d''administration', 'select public.admin_journal_lire()');
  perform t.refuse('un client lit la table des administrateurs', 'select 1 from public.administrateurs');
  perform t.refuse('un client se désigne administrateur', 'select public.admin_designer(''zzrec-a@example.test'')');
  perform t.refuse('un client donne un rôle', 'select public.admin_definir_role(''zzrec-a@example.test'', ''superadmin'')');
  perform t.role('anon');
  perform t.refuse('un visiteur appelle une fonction d''administration', 'select public.admin_moi()');

  perform t.role('service_role');
  perform public.admin_designer('ZZREC-C@example.test', 'admin');     -- c : administrateur
  perform t.refuse('désigner une adresse sans compte', 'select public.admin_designer(''personne@example.test'')');
  perform t.connecter(c);
  perform t.egal('rôle de l''administrateur', public.admin_moi(), 'admin');
  perform t.egal('tableau de bord : mode test actif', public.admin_tableau_de_bord() ->> 'mode_test', 'true');
  perform t.egal('tableau de bord : comptes', public.admin_tableau_de_bord() ->> 'comptes', '3');
  perform t.egal('recherche d''un compte par adresse', public.admin_comptes('zzrec-b') #>> '{0,email}', 'zzrec-b@example.test');
  perform t.egal('recherche sans résultat', public.admin_comptes('introuvable')::text, '[]');
  perform t.egal('détail : la liste des EDL, sans leur contenu', (select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_compte(org_b) #> '{edl,0}') k), 'date,id,source,statut,type,ville');
  perform t.lignes('l''administrateur ne lit toujours pas les EDL d''un client', format('select 1 from public.edl where organisation_id = %L', org_b), 0);
  perform t.lignes('ni ses éléments', format('select 1 from public.edl_elements el join public.edl e on e.id = el.edl_id where e.organisation_id = %L', org_b), 0);

  perform t.refuse('crédits offerts sans motif', format('select public.admin_offrir_credits(%L, 2, '' '')', org_b));
  perform t.refuse('plus de 50 crédits à la fois', format('select public.admin_offrir_credits(%L, 51, ''erreur'')', org_b));
  perform public.admin_offrir_credits(org_b, 2, 'Geste après un incident');
  perform t.egal('crédits offerts : valables 24 mois, origine tracée',
    (select (l ->> 'quantite') || ' ' || (l ->> 'origine') || ' ' || ((l ->> 'expire_le')::date - current_date > 700)
     from jsonb_array_elements(public.admin_compte(org_b) -> 'lots') l where l ->> 'origine' = 'geste_commercial'), '2 geste_commercial true');
  perform t.lignes('l''administrateur ne lit pas la table des crédits d''un client', format('select 1 from public.credit_lots where organisation_id = %L', org_b), 0);
  perform t.egal('retrait du reste d''un lot', public.admin_annuler_lot((select (l ->> 'id')::uuid from jsonb_array_elements(public.admin_compte(org_b) -> 'lots') l where l ->> 'origine' = 'geste_commercial'), 'Saisi par erreur')::text, '2');
  perform public.admin_modifier_tarif('edl_unite', 990, 1, true, 'État des lieux à l''unité');
  perform t.egal('tarif modifié', (select montant_cents::text from public.tarifs where code = 'edl_unite'), '990');
  perform t.refuse('tarif négatif', 'select public.admin_modifier_tarif(''edl_unite'', -1, 1, true, ''x'')');
  perform public.admin_definir_test(org_b, true);
  perform t.egal('compte marqué « test »', public.admin_compte(org_b) #>> '{organisation,est_test}', 'true');
  perform t.egal('message Signabail rejoué', public.admin_rejouer_signabail((select (x ->> 'id')::uuid from jsonb_array_elements(public.admin_signabail(false)) x where x ->> 'bail' = 'bail-E')), 'traite');
  perform t.egal('le message de test passe maintenant que le compte est un compte de test',
    (select count(*)::text from jsonb_array_elements(public.admin_compte(org_b) -> 'edl') x where x ->> 'source' = 'signabail'), '5');
  perform t.egal('liste des messages Signabail sans le contenu du bail', (public.admin_signabail(false) -> 0 ? 'payload')::text, 'false');

  perform t.refuse('un simple administrateur coupe le mode test', 'select public.admin_mode_test(false)');
  perform t.refuse('un simple administrateur nomme un administrateur', 'select public.admin_definir_role(''zzrec-a@example.test'', ''admin'')');
  perform t.refuse('un simple administrateur liste les administrateurs', 'select public.admin_administrateurs()');
  perform t.egal('chaque action est au journal', (select string_agg(x ->> 'action', ',' order by (x ->> 'id')::int) from jsonb_array_elements(public.admin_journal_lire()) x),
    'admin.designe_par_le_serveur,credits.offerts,credits.retires,tarif.modifie,compte.test,signabail.rejoue');
  perform t.egal('le journal garde l''avant et l''après d''un tarif',
    (select x #>> '{details,avant,montant_cents}' || '>' || (x #>> '{details,apres,montant_cents}') from jsonb_array_elements(public.admin_journal_lire()) x where x ->> 'action' = 'tarif.modifie'), '1490>990');

  perform t.role('service_role');
  perform public.admin_designer('zzrec-b@example.test', 'superadmin');
  perform t.refuse('même le serveur ne réécrit pas le journal', 'update public.admin_journal set action = ''x''');
  perform t.connecter(b);
  perform public.admin_mode_test(false);
  perform t.egal('mode test coupé par le super administrateur', (select valeur::text from public.parametres where cle = 'mode_test'), 'false');
  perform public.admin_mode_test(true);
  perform t.refuse('modifier son propre rôle', 'select public.admin_definir_role(''zzrec-b@example.test'', ''admin'')');
  perform public.admin_definir_role('zzrec-c@example.test', null);
  perform t.egal('rôle retiré', (public.admin_administrateurs() @> '[{"email": "zzrec-c@example.test"}]')::text, 'false');
  perform t.connecter(c);
  perform t.refuse('l''ancien administrateur n''a plus accès', 'select public.admin_tableau_de_bord()');
  perform t.role('service_role');
  update public.tarifs set montant_cents = 1490 where code = 'edl_unite';

  -- Présentation : filigrane pour tous, logo pour les comptes professionnels ------------
  perform t.connecter(b);
  perform t.lignes('B active le filigrane sur ses photos', format('update public.organisations set filigrane_photos = true, filigrane_texte = ''ZZREC Autre'' where id = %L', org_b), 1);
  perform t.refuse('filigrane trop long', format('update public.organisations set filigrane_texte = repeat(''x'', 61) where id = %L', org_b));
  perform t.refuse('logo sur un compte non professionnel', format('update public.organisations set logo_path = %L where id = %L', org_b || '/logo.png', org_b));
  perform t.lignes('B passe en compte professionnel', format('update public.organisations set type = ''pro'' where id = %L', org_b), 1);
  perform t.refuse('logo rangé dans le dossier d''un autre compte', format('update public.organisations set logo_path = %L where id = %L', org_a || '/logo.png', org_b));
  perform t.lignes('logo du compte professionnel', format('update public.organisations set logo_path = %L where id = %L', org_b || '/logo.png', org_b), 1);
  perform t.lignes('B ne règle pas la présentation de A', format('update public.organisations set filigrane_photos = true where id = %L', org_a), 0);
  perform t.lignes('B redevient particulier', format('update public.organisations set type = ''particulier'' where id = %L', org_b), 1);
  perform t.egal('le logo est retiré avec le statut professionnel', coalesce((select logo_path from public.organisations where id = org_b), 'aucun'), 'aucun');

  -- Paiements Stripe : tout passe par le serveur, une fois, et le mode test fait barrage ---
  perform t.connecter(b);
  perform t.refuse('B s''attribue un paiement', format('select public.stripe_recevoir(%L)', '{"id":"evt_x","type":"checkout.session.completed"}'));
  perform t.role('service_role');
  perform t.egal('message réel écarté en mode test', public.stripe_recevoir(jsonb_build_object('id', 'evt_live', 'type', 'checkout.session.completed', 'livemode', true,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_live', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_live',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'pack_10'))))), 'ecarte_mode');
  perform t.egal('aucun crédit pour le message écarté', (select count(*)::text from public.credit_lots where reference = 'stripe:pi_live'), '0');
  perform t.egal('paiement pas encore encaissé', public.stripe_recevoir(jsonb_build_object('id', 'evt_att', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_1', 'mode', 'payment', 'payment_status', 'unpaid', 'payment_intent', 'pi_1',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'pack_5'))))), 'en_attente_paiement');
  perform t.egal('achat d''un pack de 5', public.stripe_recevoir(jsonb_build_object('id', 'evt_1', 'type', 'checkout.session.async_payment_succeeded', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_1', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_1', 'customer', 'cus_B',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'pack_5'))))), 'traite');
  perform t.egal('5 crédits, valables 24 mois', (select restant || ' ' || (expire_le > now() + interval '23 months') from public.credit_lots where reference = 'stripe:pi_1'), '5 true');
  perform t.egal('client Stripe retenu', public.stripe_client(org_b), 'cus_B');
  perform t.egal('même message reçu deux fois', public.stripe_recevoir(jsonb_build_object('id', 'evt_1', 'type', 'checkout.session.async_payment_succeeded', 'livemode', false)), 'deja_traite');
  perform t.egal('même paiement annoncé par un autre message', public.stripe_recevoir(jsonb_build_object('id', 'evt_1bis', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_1', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_1',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'pack_5'))))), 'traite');
  perform t.egal('un seul lot pour ce paiement', (select count(*) || ' ' || sum(restant) from public.credit_lots where reference = 'stripe:pi_1'), '1 5');
  perform t.egal('tarif inconnu : en erreur, à retenter', public.stripe_recevoir(jsonb_build_object('id', 'evt_ko', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_ko', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_ko',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'inconnu'))))), 'erreur');
  perform t.egal('l''erreur est gardée, le message reste à traiter', (select (traite_le is null) || ' ' || erreur from public.webhook_evenements where evenement_id = 'evt_ko'), 'true Commande Stripe sans compte ou sans tarif reconnu.');
  perform t.egal('remboursement total : crédits retirés', public.stripe_recevoir(jsonb_build_object('id', 'evt_rb', 'type', 'charge.refunded', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'ch_1', 'refunded', true, 'payment_intent', 'pi_1')))), 'traite');
  perform t.egal('plus de crédit sur l''achat remboursé', (select restant::text from public.credit_lots where reference = 'stripe:pi_1'), '0');

  perform t.egal('abonnement Premium Investisseur', public.stripe_recevoir(jsonb_build_object('id', 'evt_abo', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_2', 'mode', 'subscription', 'payment_status', 'paid', 'subscription', 'sub_B', 'customer', 'cus_B',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'premium_investisseur'))))), 'traite');
  perform t.egal('Premium actif', (select exists (select 1 from public.abonnements where organisation_id = org_b and statut = 'actif' and periode_fin > now()))::text, 'true');
  perform t.egal('quota de l''année, utilisable tant que l''abonnement est payé',
    (select restant || ' ' || (expire_le < now() + interval '32 days') from public.credit_lots where reference = 'stripe:abo:sub_B:annee:0'), '12 true');
  perform t.egal('échéance réglée', public.stripe_recevoir(jsonb_build_object('id', 'evt_fac', 'type', 'invoice.paid', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'in_1', 'parent', jsonb_build_object('subscription_details', jsonb_build_object('subscription', 'sub_B')),
      'lines', jsonb_build_object('data', jsonb_build_array(jsonb_build_object('period', jsonb_build_object('end', extract(epoch from now() + interval '60 days'))))))))), 'traite');
  perform t.egal('quota prolongé, pas doublé', (select count(*) || ' ' || sum(restant) || ' ' || bool_and(expire_le > now() + interval '59 days') from public.credit_lots where reference like 'stripe:abo:sub_B:%'), '1 12 true');
  perform t.egal('échéance impayée', public.stripe_recevoir(jsonb_build_object('id', 'evt_imp', 'type', 'invoice.payment_failed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'in_2', 'subscription', 'sub_B')))), 'traite');
  perform t.egal('Premium suspendu', (select exists (select 1 from public.abonnements where organisation_id = org_b and statut = 'actif' and periode_fin > now()))::text, 'false');
  perform t.egal('résiliation', public.stripe_recevoir(jsonb_build_object('id', 'evt_fin', 'type', 'customer.subscription.deleted', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'sub_B', 'status', 'canceled')))), 'traite');
  perform t.egal('abonnement résilié, quota éteint', (select a.statut || ' ' || (l.expire_le <= now()) from public.abonnements a, public.credit_lots l
    where a.stripe_subscription_id = 'sub_B' and l.reference = 'stripe:abo:sub_B:annee:0'), 'resilie true');
  perform t.egal('facture d''un abonnement inconnu', public.stripe_recevoir(jsonb_build_object('id', 'evt_inc', 'type', 'invoice.paid', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'in_9', 'subscription', 'sub_inconnu')))), 'sans_abonnement');
  perform t.egal('type de message non géré', public.stripe_recevoir(jsonb_build_object('id', 'evt_autre', 'type', 'customer.created', 'livemode', false, 'data', jsonb_build_object('object', '{}'::jsonb))), 'ignore');

  -- Clés Stripe : saisies par le super administrateur, jamais relues ---------------------
  perform t.connecter(a);
  perform t.refuse('un client enregistre une clé', $q$select public.admin_definir_cle('stripe_cle_test', 'sk_test_abcdefghijklmnop1234')$q$);
  perform t.refuse('un client liste les clés', 'select * from public.admin_cles()');
  perform t.refuse('un client lit les clés du serveur', 'select public.cles_stripe()');
  perform t.refuse('un client lit la table des clés', 'select * from private.cles_service');
  perform t.connecter(b);   -- super administrateur
  perform t.refuse('clé réelle rangée comme clé de test', $q$select public.admin_definir_cle('stripe_cle_test', 'sk_live_abcdefghijklmnop1234')$q$);
  perform t.refuse('clé de test rangée comme clé réelle', $q$select public.admin_definir_cle('stripe_cle_reelle', 'sk_test_abcdefghijklmnop1234')$q$);
  perform t.refuse('secret de webhook mal formé', $q$select public.admin_definir_cle('stripe_webhook_test', 'sk_test_abcdefghijklmnop1234')$q$);
  perform public.admin_definir_cle('stripe_cle_test', '  sk_test_abcdefghijklmnop1234  ');
  perform public.admin_definir_cle('stripe_cle_reelle', 'sk_live_abcdefghijklmnop9876');
  perform public.admin_definir_cle('stripe_webhook_test', 'whsec_abcdefghijklmnop0001');
  perform t.egal('l''écran ne revoit que la fin des clés', (select string_agg(nom || ':' || fin, ' ' order by nom) from public.admin_cles()), 'stripe_cle_reelle:9876 stripe_cle_test:1234 stripe_webhook_test:0001');
  perform t.refuse('même le super administrateur ne relit pas une clé', 'select valeur from private.cles_service');
  perform t.egal('le journal ne garde pas la valeur', ((public.admin_journal_lire(50))::text like '%abcdefghijklmnop%')::text, 'false');
  perform t.role('service_role');
  perform t.egal('mode test : le serveur reçoit la clé de test', public.cles_stripe() ->> 'cle', 'sk_test_abcdefghijklmnop1234');
  update public.parametres set valeur = 'false' where cle = 'mode_test';
  perform t.egal('mode réel : le serveur reçoit la clé réelle', public.cles_stripe() ->> 'cle', 'sk_live_abcdefghijklmnop9876');
  update public.parametres set valeur = 'true' where cle = 'mode_test';
  perform t.connecter(b);
  perform public.admin_definir_cle('stripe_cle_test', '');
  perform t.role('service_role');
  perform t.egal('clé effacée : paiement fermé', coalesce(public.cles_stripe() ->> 'cle', 'aucune'), 'aucune');

  -- Signature électronique (DocuSeal) : payée, envoyée, close par le serveur -----------
  perform t.role('service_role');
  perform t.egal('5 € par état des lieux', (select montant_cents::text from public.tarifs where code = 'signature_electronique'), '500');
  perform t.refuse('envoi sans paiement', format('select public.edl_signature_demandee(%L, ''ds-1'', ''[]'', %L)', e2, a));
  perform t.egal('paiement de la signature d''un autre compte : en erreur', public.stripe_recevoir(jsonb_build_object('id', 'evt_sig_x', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_sx', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_sx',
      'metadata', jsonb_build_object('organisation_id', org_b, 'tarif_code', 'signature_electronique', 'edl_id', e2))))), 'erreur');
  perform t.egal('paiement de la signature', public.stripe_recevoir(jsonb_build_object('id', 'evt_sig', 'type', 'checkout.session.completed', 'livemode', false,
    'data', jsonb_build_object('object', jsonb_build_object('id', 'cs_s', 'mode', 'payment', 'payment_status', 'paid', 'payment_intent', 'pi_s',
      'metadata', jsonb_build_object('organisation_id', org_a, 'tarif_code', 'signature_electronique', 'edl_id', e2))))), 'traite');
  perform t.egal('aucun crédit versé pour ce paiement', (select count(*)::text from public.credit_lots where reference = 'stripe:pi_s'), '0');
  perform t.egal('signature réglée', (select statut from public.edl_signature_electronique where edl_id = e2), 'payee');
  perform t.refuse('clôture sans demande en cours', format('select public.edl_clore_electronique(%L, %L, %L)', e2, org_a || '/' || e2 || '/pdf/ds.pdf', repeat('e', 64)));
  perform t.connecter(a);
  perform t.lignes('A voit le suivi de sa signature', format('select 1 from public.edl_signature_electronique where edl_id = %L', e2), 1);
  perform t.refuse('A marque lui-même la signature envoyée', format('select public.edl_signature_demandee(%L, ''ds-1'', ''[]'', %L)', e2, a));
  perform t.refuse('A écrit dans le suivi', format('update public.edl_signature_electronique set statut = ''signee'' where edl_id = %L', e2));
  perform t.connecter(b);
  perform t.lignes('B ne voit pas le suivi de A', 'select 1 from public.edl_signature_electronique', 0);
  perform t.connecter(b);
  perform t.refuse('adresse DocuSeal mal formée', $q$select public.admin_definir_cle('docuseal_url', 'pas une adresse')$q$);
  perform public.admin_definir_cle('docuseal_cle', 'abcdefghijklmnopqrstuvwxyz012345');
  perform t.role('service_role');
  perform t.egal('clé DocuSeal pour le serveur, adresse européenne par défaut', public.cles_docuseal() ->> 'cle' || ' ' || (public.cles_docuseal() ->> 'url'), 'abcdefghijklmnopqrstuvwxyz012345 https://api.docuseal.eu');

  -- Équipe d'agence : commerciaux sans facturation, droits réglés par l'administrateur ----
  perform t.connecter(b);
  perform t.refuse('un compte non professionnel invite', format('select public.equipe_inviter(''ZZREC Paul'', %L, ''{}'')', encode(sha256('jeton-0'), 'hex')));
  perform t.connecter(a);
  perform t.lignes('A passe en compte professionnel', format('update public.organisations set type = ''pro'' where id = %L', org_a), 1);
  perform public.equipe_inviter('ZZREC Paul Commercial', encode(sha256('jeton-1'), 'hex'), '{"generer": false, "voir_tous": false, "supprimer": false}');
  perform t.role('anon');
  perform t.egal('l''invité voit seulement le nom de l''agence', (public.equipe_invitation('jeton-1') ->> 'pour'), 'ZZREC Paul Commercial');
  perform t.egal('jeton inconnu : rien', coalesce(public.equipe_invitation('jeton-faux')::text, 'rien'), 'rien');
  perform t.refuse('un visiteur lit les invitations', 'select * from public.organisation_invitations');
  perform t.connecter(c);
  perform t.egal('C rejoint l''équipe de A', public.equipe_rejoindre('jeton-1')::text, org_a::text);
  perform t.refuse('l''invitation ne sert qu''une fois', 'select public.equipe_rejoindre(''jeton-1'')');
  perform t.egal('C n''a plus que ce compte', (select count(*)::text from public.organisation_membres where user_id = c), '1');
  -- (C reste partie, comme locataire, à un état des lieux signé : il le voit à ce titre, pas comme collègue)
  perform t.lignes('C ne voit pas les états des lieux de ses collègues', 'select 1 from public.edl where statut <> ''signe''', 0);
  perform t.lignes('C ne voit pas les crédits de l''agence', 'select 1 from public.credit_lots', 0);
  perform t.lignes('C ne voit pas l''abonnement', 'select 1 from public.abonnements', 0);
  perform t.refuse('C gère l''équipe', 'select public.equipe_membres()');
  perform t.refuse('C se donne des droits', format('select public.equipe_regler(%L, ''{"generer": true}'')', c));
  perform t.refuse('C invite quelqu''un', format('select public.equipe_inviter(''ZZREC X'', %L, ''{}'')', encode(sha256('jeton-2'), 'hex')));
  insert into public.edl (id, organisation_id, logement_id, type, realise_par) values ('00000000-0000-4000-a000-0000000000e9', org_a, log, 'entrant', c);
  perform t.lignes('C voit l''état des lieux qu''il réalise', 'select 1 from public.edl where statut <> ''signe''', 1);
  perform t.refuse('C génère sans en avoir le droit', 'select public.edl_finaliser(''00000000-0000-4000-a000-0000000000e9'')');
  perform t.refuse('C supprime sans en avoir le droit', 'delete from public.edl where id = ''00000000-0000-4000-a000-0000000000e9''');
  perform t.connecter(b);
  perform t.refuse('un autre compte règle les droits de C', format('select public.equipe_regler(%L, ''{"generer": true}'')', c));
  perform t.connecter(a);
  perform t.egal('A voit son équipe', jsonb_array_length(public.equipe_membres())::text, '2');
  perform t.refuse('A se retire lui-même', format('select public.equipe_retirer(%L)', a));
  perform public.equipe_regler(c, '{"generer": true, "voir_tous": true, "supprimer": true}');
  perform t.connecter(c);
  perform t.egal('droit accordé : C voit tous les états des lieux', ((select count(*) from public.edl where statut <> 'signe') > 1)::text, 'true');
  perform t.lignes('droit accordé : C supprime son brouillon', 'delete from public.edl where id = ''00000000-0000-4000-a000-0000000000e9''', 1);
  perform t.lignes('même avec tous les droits, pas de facturation', 'select 1 from public.credit_lots', 0);
  perform t.connecter(a);
  perform public.equipe_retirer(c);
  perform t.connecter(c);
  perform t.lignes('retiré : C ne voit plus rien de l''agence', 'select 1 from public.edl where statut <> ''signe'' and organisation_id = ' || quote_literal(org_a), 0);
  perform t.egal('retiré : C retrouve un compte personnel', (select role::text from public.organisation_membres where user_id = c), 'proprietaire');

  -- Visiteur non connecté -------------------------------------------------------------
  perform t.role('anon');
  perform t.lignes('visiteur lit les tarifs', 'select code from public.tarifs', 9);
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
