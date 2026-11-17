import { describe, expect, it } from 'vitest';
import { avancement, lignesDepuisModele } from './edl';
import { MODELES_LOGEMENT, PIECES_TYPES, detailAttendu, pieceType } from './trame';

describe('trame', () => {
  it('chaque modèle ne cite que des pièces connues', () => {
    for (const m of MODELES_LOGEMENT) for (const p of m.pieces) expect(PIECES_TYPES.some((t) => t.id === p.type), `${m.id}/${p.type}`).toBe(true);
  });
  it('propose studio, T1 à T6, maison, garage et local', () => {
    expect(MODELES_LOGEMENT.map((m) => m.id)).toEqual(['studio', 't1', 't2', 't3', 't4', 't5', 't6', 'maison', 'garage', 'local']);
  });
  it('un T3 a deux chambres numérotées', () => {
    const noms = MODELES_LOGEMENT.find((m) => m.id === 't3')!.pieces.map((p) => p.label ?? pieceType(p.type).label);
    expect(noms).toEqual(['Entrée', 'Séjour', 'Cuisine', 'Chambre 1', 'Chambre 2', 'Salle de bain', 'WC', 'Équipements et sécurité']);
  });
  it('les éléments d’une pièce ont des identifiants uniques', () => {
    for (const t of PIECES_TYPES) expect(new Set(t.elements.map((x) => x.id)).size, t.id).toBe(t.elements.length);
  });
  it('le jardin couvre les rubriques du cahier des charges', () => {
    const ids = pieceType('jardin').elements.map((x) => x.id);
    for (const attendu of ['pelouse', 'arbres', 'plantations', 'massifs', 'potager', 'invasives', 'arrosage', 'cloture', 'terrasse', 'abri', 'eclairage', 'eau_compost', 'proprete'])
      expect(ids).toContain(attendu);
    expect(PIECES_TYPES.some((t) => t.id === 'piscine')).toBe(true);
  });
  it('retrouve la précision attendue', () => {
    expect(detailAttendu('jardin', 'pelouse')).toBe('Tondue le…');
    expect(detailAttendu('sejour', 'sol')).toBeUndefined();
  });
});

describe('création', () => {
  it('génère pièces et éléments rattachés', () => {
    const { pieces, elements } = lignesDepuisModele('edl-1', 'studio');
    expect(pieces).toHaveLength(6);
    expect(elements.every((el) => pieces.some((p) => p.id === el.piece_id) && el.edl_id === 'edl-1')).toBe(true);
    expect(new Set(elements.map((el) => el.id)).size).toBe(elements.length);
  });
  it('compte l’avancement et ce qui est à signaler', () => {
    expect(avancement([{ etat: 'bon' }, { etat: null }, { etat: 'hors_service' }, { etat: 'sans_objet' }, { etat: 'mauvais' }])).toEqual({ total: 5, faits: 4, aSignaler: 2 });
  });
});
