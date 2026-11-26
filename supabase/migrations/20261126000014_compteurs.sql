-- =============================================================================
-- Constatio — 14 : compteurs
--   * eau : compteur individuel ou collectif ;
--   * « compteur vérifié » : on a fait couler l'eau et constaté que ce compteur
--     tourne — c'est bien celui du logement (erreur fréquente en immeuble) ;
--   * chauffage collectif : relevé du compteur de chaleur ou des répartiteurs.
-- =============================================================================
alter type public.compteur_type add value if not exists 'chauffage';
alter table public.edl_compteurs
  add column collectif boolean not null default false,
  add column verifie   boolean not null default false;
