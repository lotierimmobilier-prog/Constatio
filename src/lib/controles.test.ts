import { describe, expect, it } from 'vitest';
import { MOBILIER_DECRET, controler, type DonneesControle } from './controles';

const complet = (): DonneesControle => ({
  type: 'entrant', meuble: false, sansCompteurs: false, entreeConnue: false,
  parties: [
    { role: 'bailleur', nom: 'Vidal', nouvelle_adresse: null, represente_id: null },
    { role: 'locataire', nom: 'Marty', nouvelle_adresse: null, represente_id: null },
  ],
  pieces: [{ id: 'p1', nom: 'Séjour' }],
  elements: [{ piece_id: 'p1', libelle: 'Sol', etat: 'bon', observations: null }],
  compteurs: [
    { type: 'electricite', absent: false, index_1: 18432, index_2: 9877, double_tarif: true, numero: '0945' },
    { type: 'eau_froide', absent: false, index_1: 214, index_2: null, double_tarif: false, numero: 'E12' },
    { type: 'eau_chaude', absent: true, index_1: null, index_2: null, double_tarif: false, numero: null },
    { type: 'gaz', absent: true, index_1: null, index_2: null, double_tarif: false, numero: null },
  ],
  cles: [{ nombre: 3, destination: 'Porte palière' }],
  inventaire: [],
});
const messages = (d: DonneesControle) => controler(d).map((x) => x.message);

describe('controler', () => {
  it('un état des lieux complet ne lève aucune alerte', () => {
    expect(controler(complet())).toEqual([]);
  });
  it('signale les parties manquantes', () => {
    const d = complet(); d.parties = [];
    expect(messages(d)).toEqual(['Le bailleur n’est pas identifié.', 'Aucun locataire n’est identifié.']);
  });
  it('renvoie vers la pièce dont des éléments n’ont pas d’état', () => {
    const d = complet();
    d.elements.push({ piece_id: 'p1', libelle: 'Murs', etat: null, observations: null }, { piece_id: 'p1', libelle: 'Plafond', etat: null, observations: null });
    expect(controler(d)).toEqual([{ niveau: 'bloquant', message: 'Séjour : 2 éléments sans état.', vers: 'pieces/p1', action: 'Ouvrir la pièce' }]);
  });
  it('« sans objet » vaut réponse', () => {
    const d = complet(); d.elements[0].etat = 'sans_objet';
    expect(controler(d)).toEqual([]);
  });
  it('conseille de décrire un défaut noté sans observation', () => {
    const d = complet(); d.elements[0].etat = 'hors_service';
    const [x] = controler(d);
    expect(x.niveau).toBe('conseil');
    expect(x.message).toContain('sol en mauvais état sans observation');
    d.elements[0].observations = 'Lame cassée';
    expect(controler(d)).toEqual([]);
  });
  it('un compteur est relevé ou déclaré absent, jamais vide', () => {
    const d = complet(); d.compteurs = d.compteurs.filter((c) => c.type !== 'gaz');
    d.compteurs[1].index_1 = null;
    expect(messages(d)).toEqual([
      'Eau froide : compteur non relevé. Indiquez l’index, ou qu’il n’y a pas de compteur.',
      'Gaz : compteur non relevé. Indiquez l’index, ou qu’il n’y a pas de compteur.',
    ]);
  });
  it('exige les heures creuses en double tarif et conseille le numéro', () => {
    const d = complet(); d.compteurs[0].index_2 = null; d.compteurs[0].numero = '';
    expect(controler(d).map((x) => [x.niveau, x.message])).toEqual([
      ['bloquant', 'Électricité : l’index heures creuses manque.'],
      ['conseil', 'Électricité : le numéro du compteur n’est pas noté.'],
    ]);
  });
  it('exige des clés décrites', () => {
    const d = complet(); d.cles = [];
    expect(messages(d)).toEqual(['Aucune clé n’est décrite.']);
    d.cles = [{ nombre: 2, destination: ' ' }];
    expect(messages(d)).toEqual(['Une clé n’a pas de destination ou de nombre.']);
  });
  it('meublé : nomme les équipements du décret qui manquent', () => {
    const d = complet(); d.meuble = true;
    d.inventaire = MOBILIER_DECRET.filter((m) => m.code !== 'plaques' && m.code !== 'four').map((m) => ({ code_decret: m.code }));
    const [x] = controler(d);
    expect(x.message).toBe('Meublé : il manque plaques de cuisson ; four ou four à micro-ondes (décret n° 2015-981).');
    expect(x.vers).toBe('inventaire');
    d.inventaire = MOBILIER_DECRET.map((m) => ({ code_decret: m.code }));
    expect(controler(d)).toEqual([]);
  });
  it('sortie : nouvelle adresse obligatoire, entrée absente rappelée', () => {
    const d = complet(); d.type = 'sortant';
    expect(controler(d).map((x) => x.niveau)).toEqual(['bloquant', 'conseil']);
    d.parties[1].nouvelle_adresse = '3 impasse des Lilas, Trèbes'; d.entreeConnue = true;
    expect(controler(d)).toEqual([]);
  });
  it('garage : ni compteur ni inventaire attendus', () => {
    const d = complet(); d.sansCompteurs = true; d.compteurs = []; d.meuble = true;
    expect(controler(d)).toEqual([]);
  });
});
