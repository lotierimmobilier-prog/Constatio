import { describe, expect, it } from 'vitest';
import { rediger, type Contexte, type Destinataire, type Evenement, type Role } from './courriel-edl';

const c: Contexte = { type: 'entrant', lieu: '8 rue de la Signature, 34500 Béziers', signeLe: '26 novembre 2026 à 15:02', limite: '6 décembre 2026 à 15:02',
  reserve: { auteur: 'M. Hugo Marty', piece: 'Séjour', texte: 'Fissure au plafond', photos: 2, statut: 'accepte', reponse: 'Constaté le lendemain.' },
  bilan: { total: 3, acceptees: 1, refusees: 1, attente: 1 } };
const d = (role: Role, plus: Partial<Destinataire> = {}): Destinataire => ({ nom: 'Mme Test', role, represente: role.startsWith('mandataire') ? 'M. Représenté' : null, ...plus });
const tout = (r: ReturnType<typeof rediger>) => [r.sujet, r.titre, ...r.paragraphes, r.bouton, ...r.apres].join('\n');

describe('e-mails de l’état des lieux', () => {
  it('chaque événement a un texte pour chaque partie, sans trou ni « undefined »', () => {
    for (const e of ['signe', 'depot', 'reponse', 'cloture'] as Evenement[])
      for (const role of ['bailleur', 'locataire', 'mandataire_bailleur', 'mandataire_locataire'] as Role[])
        for (const type of ['entrant', 'sortant']) {
          const t = tout(rediger(e, d(role), { ...c, type }));
          expect(t, `${e} ${role}`).not.toMatch(/undefined|null|\[object/);
          expect(t).toContain('Bonjour Mme Test,');
          expect(t).toContain('8 rue de la Signature');
        }
  });
  it('après les signatures : dix jours pour le locataire, information pour le bailleur, dépôt de garantie à la sortie', () => {
    expect(tout(rediger('signe', d('locataire'), c))).toContain('Vous disposez de dix jours, jusqu’au 6 décembre 2026 à 15:02');
    expect(tout(rediger('signe', d('bailleur'), c))).toContain('Le locataire dispose de dix jours');
    expect(tout(rediger('signe', d('mandataire_locataire'), c))).toContain('M. Représenté dispose de dix jours');
    expect(tout(rediger('signe', d('mandataire_bailleur'), c))).toContain('en votre qualité de mandataire de M. Représenté');
    const sortie = tout(rediger('signe', d('locataire'), { ...c, type: 'sortant', limite: null }));
    expect(sortie).toContain('état des lieux de sortie');
    expect(sortie).toContain('nouvelle adresse');
    expect(sortie).not.toContain('dix jours');
  });
  it('réserve déposée : accusé de réception pour son auteur, validation demandée côté bailleur', () => {
    const auteur = rediger('depot', d('locataire', { estAuteur: true }), c);
    expect(auteur.titre).toBe('Votre réserve est enregistrée');
    expect(tout(auteur)).toContain('avec 2 photos');
    const bailleur = rediger('depot', d('bailleur'), c);
    expect(bailleur.sujet).toBe('Réserve à valider — 8 rue de la Signature, 34500 Béziers');
    expect(tout(bailleur)).toContain('M. Hugo Marty a déposé une réserve');
    expect(tout(bailleur)).toContain('« Fissure au plafond »');
    expect(rediger('depot', d('locataire'), c).titre).toBe('Une réserve a été déposée');
  });
  it('réponse : acceptée ou refusée, avec la voie de recours en cas de refus', () => {
    expect(rediger('reponse', d('locataire', { estAuteur: true }), c).titre).toBe('Votre réserve a été acceptée');
    const refus = rediger('reponse', d('locataire', { estAuteur: true }), { ...c, reserve: { ...c.reserve!, statut: 'refuse' } });
    expect(refus.titre).toBe('Votre réserve a été refusée');
    expect(tout(refus)).toContain('commission départementale de conciliation');
    expect(tout(rediger('reponse', d('bailleur'), c))).toContain('La réserve de M. Hugo Marty');
  });
  it('fin du délai : le bilan des réserves, et ce qu’il reste à faire pour chacun', () => {
    const bailleur = tout(rediger('cloture', d('bailleur'), c));
    expect(bailleur).toContain('3 réserves ont été déposées : 1 acceptée, 1 refusée, 1 en attente de réponse');
    expect(bailleur).toContain('Il reste 1 réserve sans réponse');
    const locataire = tout(rediger('cloture', d('locataire'), { ...c, bilan: { total: 0, acceptees: 0, refusees: 0, attente: 0 } }));
    expect(locataire).toContain('Aucune réserve n’a été déposée');
    expect(locataire).toContain('période de chauffe');
  });
});
