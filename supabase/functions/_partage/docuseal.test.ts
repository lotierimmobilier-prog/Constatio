import { describe, expect, it } from 'vitest';
import { adresseApp, champsDepuisCases, statutDepuisPrestataire } from './docuseal';

describe('DocuSeal', () => {
  it('place chaque case de signature en fractions de page, origine en haut, pages à partir de 1', () => {
    const signataires = [{ partie_id: 'b', role: 'Bailleur', nom: 'Vidal', email: 'b@x.fr' }, { partie_id: 'l', role: 'Locataire', nom: 'Marty', email: 'l@x.fr' }];
    const champs = champsDepuisCases([{ partie_id: 'l', page: 2, x: 59.528, y: 84.189, largeur: 297.64, hauteur: 84.189 }, { partie_id: 'inconnu', page: 0, x: 0, y: 0, largeur: 1, hauteur: 1 }], signataires);
    expect(champs).toHaveLength(1);
    expect(champs[0]).toMatchObject({ type: 'signature', role: 'Locataire' });
    const a = champs[0].areas[0];
    expect(a.page).toBe(3);
    expect(a.x).toBeCloseTo(0.1); expect(a.w).toBeCloseTo(0.5); expect(a.h).toBeCloseTo(0.1);
    expect(a.y).toBeCloseTo(0.8); // 10 % de marge en bas + 10 % de hauteur → le haut de la case est à 80 % depuis le haut
  });
  it('ne tient pour signé que ce que le prestataire dit terminé', () => {
    expect(statutDepuisPrestataire('completed')).toBe('signee');
    expect(statutDepuisPrestataire('declined')).toBe('annulee');
    expect(statutDepuisPrestataire('expired')).toBe('annulee');
    expect(statutDepuisPrestataire('pending')).toBe('en_signature');
    expect(statutDepuisPrestataire('quelque chose de nouveau')).toBe('en_signature');
  });
  it('déduit l’adresse où l’on signe de celle de l’API', () => {
    expect(adresseApp('https://api.docuseal.eu')).toBe('https://docuseal.eu');
    expect(adresseApp('https://signature.exemple.fr/api/')).toBe('https://signature.exemple.fr');
  });
});
