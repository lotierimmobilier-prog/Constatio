import { describe, expect, it } from 'vitest';
import { codePostalValide, emailValide, motDePasseValide, siretValide } from './validation';
import { traduireErreur } from './erreurs';

describe('validation', () => {
  it('reconnaît un e-mail', () => {
    expect(emailValide('claire@exemple.fr')).toBe(true);
    expect(emailValide('claire@exemple')).toBe(false);
    expect(emailValide('claire exemple.fr')).toBe(false);
  });
  it('exige 10 caractères pour le mot de passe', () => {
    expect(motDePasseValide('123456789')).toBe(false);
    expect(motDePasseValide('1234567890')).toBe(true);
  });
  it('contrôle la clé du SIRET', () => {
    expect(siretValide('732 829 320 00074')).toBe(true);
    expect(siretValide('73282932000075')).toBe(false);
    expect(siretValide('1234')).toBe(false);
  });
  it('contrôle le code postal', () => {
    expect(codePostalValide('34500')).toBe(true);
    expect(codePostalValide('3450')).toBe(false);
  });
});

describe('traduireErreur', () => {
  it('traduit par code', () => {
    expect(traduireErreur({ code: 'invalid_credentials' })).toBe('E-mail ou mot de passe incorrect.');
  });
  it('traduit par message quand le code manque', () => {
    expect(traduireErreur({ message: 'User already registered' })).toMatch(/existe déjà/);
    expect(traduireErreur(new TypeError('Failed to fetch'))).toMatch(/réseau/);
  });
  it('ne laisse jamais passer de message technique', () => {
    expect(traduireErreur({ message: 'pq: deadlock detected' })).toBe('Une erreur est survenue. Réessayez dans un instant.');
  });
});
