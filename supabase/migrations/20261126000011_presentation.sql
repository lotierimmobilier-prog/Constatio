-- =============================================================================
-- Constatio — 11 : présentation des documents
--   * filigrane sur les photos du document (texte choisi par le compte, suivi de
--     la date et de l'heure de la prise de vue). Les photos d'origine ne sont
--     jamais modifiées : leur empreinte reste la preuve ; le filigrane est posé
--     dans le PDF.
--   * logo du compte en tête du document : comptes professionnels (le fichier vit
--     dans le bucket « marque », chemin déjà porté par organisations.logo_path).
-- =============================================================================
alter table public.organisations
  add column filigrane_photos boolean not null default false,
  add column filigrane_texte  text check (filigrane_texte is null or char_length(filigrane_texte) <= 60);

grant update (filigrane_photos, filigrane_texte) on public.organisations to authenticated;

-- Le logo est réservé aux comptes professionnels : garantie de la base, pas seulement de l'écran.
create function private.controle_logo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.logo_path is not null and new.type <> 'pro' then
    if tg_op = 'UPDATE' and old.logo_path is not null and new.type is distinct from old.type then
      new.logo_path := null;                      -- le compte n'est plus professionnel : le logo est retiré
    else
      raise exception 'Le logo sur les documents est réservé aux comptes professionnels.' using errcode = 'P0001';
    end if;
  end if;
  if new.logo_path is not null and new.logo_path not like new.id || '/%' then
    raise exception 'Logo refusé.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger organisations_logo before insert or update on public.organisations
  for each row execute function private.controle_logo();
