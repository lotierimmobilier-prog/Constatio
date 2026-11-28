begin;
-- =============================================================================
-- Constatio — 24 : photo du trousseau de clés
-- -----------------------------------------------------------------------------
-- Une photo peut désormais se rattacher aux clés remises (« objet = cles »).
-- Elle est exigée par les contrôles dès qu'une clé est décrite : c'est la preuve
-- de ce qui a été remis, et de ce qui sera réclamé à la sortie.
-- =============================================================================
alter table public.edl_photos add column objet text check (objet in ('cles'));
commit;
