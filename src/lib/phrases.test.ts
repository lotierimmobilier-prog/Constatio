import { describe, expect, it } from 'vitest';
import { ajouterPhrase, phrasesTypes } from './phrases';
import { PIECES_TYPES } from './trame';

describe('phrases types', () => {
  it('propose des phrases adaptées à l’élément', () => {
    expect(phrasesTypes('sol')).toContain('Rayures superficielles');
    expect(phrasesTypes('fenetres')).toContain('Vitrage fêlé');
    expect(phrasesTypes('robinet_evier')).toContain('Goutte à goutte');
    expect(phrasesTypes('pelouse')).toContain('Tondu récemment');
    expect(phrasesTypes('autre')).toContain('Traces d’usage');
  });
  it('tout élément de la trame reçoit des propositions', () => {
    for (const p of PIECES_TYPES) for (const e of p.elements) expect(phrasesTypes(e.id).length, `${p.id}/${e.id}`).toBeGreaterThan(2);
  });
  it('ajoute une phrase avec sa ponctuation, sans doublon', () => {
    expect(ajouterPhrase(null, 'Carreau fêlé')).toBe('Carreau fêlé.');
    expect(ajouterPhrase('Rayure de 10 cm', 'Carreau fêlé')).toBe('Rayure de 10 cm. Carreau fêlé.');
    expect(ajouterPhrase('Rayure de 10 cm.', 'Carreau fêlé')).toBe('Rayure de 10 cm. Carreau fêlé.');
    expect(ajouterPhrase('Carreau fêlé.', 'carreau fêlé')).toBe('Carreau fêlé.');
  });
});
