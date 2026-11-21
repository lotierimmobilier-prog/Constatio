import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { dimensionsCibles, empreinte, lieuPhoto } from './photos';

describe('photos', () => {
  it('réduit le plus grand côté à 1600 px en gardant les proportions', () => {
    expect(dimensionsCibles(4000, 3000)).toEqual({ largeur: 1600, hauteur: 1200 });
    expect(dimensionsCibles(3000, 4000)).toEqual({ largeur: 1200, hauteur: 1600 });
    expect(dimensionsCibles(4032, 2268)).toEqual({ largeur: 1600, hauteur: 900 });
  });
  it('n’agrandit jamais une petite image', () => {
    expect(dimensionsCibles(800, 600)).toEqual({ largeur: 800, hauteur: 600 });
    expect(dimensionsCibles(1600, 1600)).toEqual({ largeur: 1600, hauteur: 1600 });
  });
  it('calcule l’empreinte SHA-256 du fichier', async () => {
    expect(await empreinte(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await empreinte(new Blob(['abd']))).not.toBe(await empreinte(new Blob(['abc'])));
  });
  it('affiche la position avec sa précision, ou rien', () => {
    expect(lieuPhoto({ latitude: 43.344231, longitude: 3.215812, precision_m: 12 })).toBe('43.34423, 3.21581 (± 12 m)');
    expect(lieuPhoto({ latitude: null, longitude: null, precision_m: null })).toBeNull();
  });
});
