import { describe, expect, it } from 'vitest';
import { FONCTIONNEMENT, chercher, indexer, racines } from './assistant';

const guides = [
  { q: 'Quel est le délai pour rendre le dépôt de garantie ?', r: 'Un mois si l’état des lieux de sortie est conforme à celui d’entrée, deux mois sinon.', url: '/guides/depot/', source: 'Guide : restitution du dépôt' },
  { q: 'Le locataire peut-il compléter l’état des lieux après l’avoir signé ?', r: 'Oui, dans les dix jours, et pendant le premier mois de chauffe pour le chauffage.', url: '/guides/complement/', source: 'Guide : complément' },
  { q: 'Quels équipements sont obligatoires dans un meublé ?', r: 'Onze équipements : literie, plaques de cuisson, réfrigérateur, vaisselle…', url: '/guides/meuble/', source: 'Guide : meublé' },
];
const index = indexer([...FONCTIONNEMENT, ...guides]);
const premiere = (question: string) => chercher(index, question)[0]?.fiche.q;

describe('assistant', () => {
  it('ramène les mots à leur racine, sans accents ni mots vides', () => {
    expect(racines('Combien coûtent les états des lieux ?')).toEqual(racines('cout etat lieu'));
  });
  it('retrouve une réponse sur le fonctionnement, quelle que soit la tournure', () => {
    expect(premiere('ça coûte combien ?')).toBe('Combien coûte un état des lieux ?');
    expect(premiere('est-ce que je peux travailler sans internet dans la cave')).toMatch(/sans réseau/);
    expect(premiere('ajouter le logo de mon agence')).toMatch(/logo/);
    expect(premiere('filigrane photos')).toMatch(/filigrane/);
    expect(premiere('je veux résilier')).toMatch(/résilier/);
    expect(premiere('le locataire doit il avoir un compte pour signer')).toMatch(/signer le locataire/);
  });
  it('retrouve une réponse réglementaire tirée des guides', () => {
    expect(premiere('sous combien de temps rendre le dépôt de garantie')).toBe('Quel est le délai pour rendre le dépôt de garantie ?');
    expect(premiere('que faut-il comme équipements dans un logement meublé')).toMatch(/meublé/);
    expect(premiere('le locataire veut compléter après signature')).toMatch(/compléter/);
  });
  it('préfère dire qu’il ne sait pas plutôt que de répondre à côté', () => {
    expect(chercher(index, 'quelle est la capitale du Pérou')).toEqual([]);
    expect(chercher(index, '???')).toEqual([]);
    expect(chercher(index, 'bonjour')).toEqual([]);
  });
  it('propose au plus trois fiches, la meilleure d’abord', () => {
    const r = chercher(index, 'signature du locataire');
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.map((x) => x.score)).toEqual([...r.map((x) => x.score)].sort((a, b) => b - a));
  });
});
