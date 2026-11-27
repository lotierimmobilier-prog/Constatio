import { describe, expect, it } from 'vitest';
import { ajouterMois, bilan, centimes, degradations, montantRetenu, vetustePct } from './decompte';
import type { Element } from './edl';

const peinture = { duree_vie_ans: 7, franchise_ans: 0, part_residuelle_pct: 10 };
const carrelage = { duree_vie_ans: 25, franchise_ans: 5, part_residuelle_pct: 20 };
const el = (id: string, etat: Element['etat'], origine_id: string | null = null): Element => ({ id, edl_id: 'e', piece_id: 'p', categorie: 'sol', libelle: id, nature: null, etat, observations: null, detail: null, ordre: 0, origine_id });

describe('décompte du dépôt de garantie', () => {
  it('vétusté : nulle pendant la franchise, régulière ensuite, jamais au-delà de la part laissée au bailleur', () => {
    expect(vetustePct(peinture, 0)).toBe(0);
    expect(vetustePct(peinture, 3.5)).toBe(45);
    expect(vetustePct(peinture, 7)).toBe(90);
    expect(vetustePct(peinture, 30)).toBe(90);
    expect(vetustePct(carrelage, 5)).toBe(0);
    expect(vetustePct(carrelage, 15)).toBe(40);
    expect(vetustePct(carrelage, 25)).toBe(80);
  });
  it('montant retenu : le devis, vétusté déduite, au centime', () => {
    expect(montantRetenu(45000, 45)).toBe(24750);
    expect(montantRetenu(45000, 0)).toBe(45000);
    expect(montantRetenu(9999, 33.33)).toBe(6666);
    expect(montantRetenu(1000, 150)).toBe(0);
  });
  it('dégradations : seulement ce qui est plus abîmé qu’à l’entrée', () => {
    const entree = [el('a', 'bon'), el('b', 'usage'), el('c', 'neuf'), el('d', 'bon')];
    const sortie = [el('a2', 'mauvais', 'a'), el('b2', 'usage', 'b'), el('c2', 'bon', 'c'), el('d2', 'sans_objet', 'd'), el('nouveau', 'mauvais')];
    expect(degradations(sortie, entree).map((x) => `${x.element.id}:${x.avant}>${x.apres}`)).toEqual(['a2:bon>mauvais', 'c2:neuf>bon']);
  });
  it('délai : un mois si la sortie est conforme, deux mois sinon', () => {
    expect(bilan(80000, [], 0, '2026-11-15', 0)).toMatchObject({ aRestituer: 80000, conforme: true, dateLimite: '2026-12-15' });
    expect(bilan(80000, [{ montant_retenu_cents: 24750 }], 5000, '2026-11-15', 1)).toMatchObject({ retenues: 24750, aRestituer: 50250, resteDu: 0, conforme: false, dateLimite: '2027-01-15' });
    // Une dégradation relevée sans retenue chiffrée : la sortie n'est pas conforme pour autant.
    expect(bilan(80000, [], 0, '2026-11-15', 2).conforme).toBe(false);
  });
  it('retenues supérieures au dépôt : rien à restituer, et un reste dû', () => {
    expect(bilan(50000, [{ montant_retenu_cents: 60000 }], 10000, '2026-11-15', 1)).toMatchObject({ aRestituer: 0, resteDu: 20000 });
  });
  it('fin de mois : le 31 décembre plus deux mois tombe le dernier jour de février', () => {
    expect(ajouterMois('2026-12-31', 2)).toBe('2027-02-28');
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2026-11-30', 1)).toBe('2026-12-30');
  });
  it('lit un montant saisi à la française', () => {
    expect(centimes('450')).toBe(45000);
    expect(centimes('1 250,50 €')).toBe(125050);
    expect(centimes('12.5')).toBe(1250);
    expect(centimes('douze')).toBeNull();
    expect(centimes('-5')).toBeNull();
  });
});
