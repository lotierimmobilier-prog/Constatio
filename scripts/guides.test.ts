import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JavaScript sans types
import { controler, lireGuides } from './guides.mjs';

const guides: { slug: string; titre: string; date: string; description: string; image_alt: string }[] = lireGuides();
const slugs = guides.map((g) => g.slug);

describe('guides', () => {
  it('trente-deux guides, chacun avec sa propre date de publication', () => {
    expect(guides).toHaveLength(32);
    expect(new Set(guides.map((g) => g.date)).size).toBe(32);
  });
  it.each(guides.map((g) => [g.slug, g] as const))('%s est complet et ses liens internes existent', (_slug, guide) => {
    expect(controler(guide, slugs).erreurs).toEqual([]);
  });
  it('titres et descriptions tiennent dans un résultat de recherche', () => {
    for (const g of guides) expect(controler(g, slugs).avis, g.slug).toEqual([]);
  });
  it('chaque guide a son illustration dessinée et son texte alternatif, tous différents', () => {
    for (const g of guides) expect(existsSync(new URL(`../public/guides/illustrations/${g.slug}.jpg`, import.meta.url)), `${g.slug} : lancer « node scripts/illustrer-guides.mjs »`).toBe(true);
    expect(new Set(guides.map((g) => g.image_alt)).size).toBe(guides.length);
  });
  it('aucun titre en double', () => expect(new Set(guides.map((g) => g.titre)).size).toBe(guides.length));
});
