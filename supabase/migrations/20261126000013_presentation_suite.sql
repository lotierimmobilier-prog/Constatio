-- =============================================================================
-- Constatio — 13 : image de filigrane
-- En plus du bandeau de texte, le compte peut déposer une image à fond
-- transparent (PNG), posée en transparence au centre de chaque photo du document.
-- Le fichier vit dans le bucket « marque », dans le dossier du compte.
-- =============================================================================
alter table public.organisations add column filigrane_image_path text;
grant update (filigrane_image_path) on public.organisations to authenticated;

create function private.controle_filigrane_image() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.filigrane_image_path is not null and new.filigrane_image_path not like new.id || '/%' then
    raise exception 'Image de filigrane refusée.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger organisations_filigrane_image before insert or update on public.organisations
  for each row execute function private.controle_filigrane_image();

-- Photos du document sur deux ou trois colonnes (tous les comptes), et couleur
-- d'accent du document (comptes professionnels ; ignorée pour les autres).
alter table public.organisations
  add column photos_colonnes   smallint not null default 2 check (photos_colonnes in (2, 3)),
  add column couleur_documents text check (couleur_documents is null or couleur_documents ~ '^#[0-9a-f]{6}$');
grant update (photos_colonnes, couleur_documents) on public.organisations to authenticated;
