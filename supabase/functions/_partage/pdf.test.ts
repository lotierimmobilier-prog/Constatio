import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { construirePdf, empreintePdf, net, type DonneesPdf } from './pdf';

/** Une petite image JPEG valide (8 × 6 pixels gris). */
const JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCSiiitTE//2Q=='), (c) => c.charCodeAt(0));

export const exemple = (type: DonneesPdf['edl']['type'] = 'entrant'): DonneesPdf => ({
  apercu: false, mention: 'Réalisé avec Constatio — partenaire Signabail',
  emetteur: { nom: 'ZZREC SCI des Balances', adresse: '12 rue des Balances, 34500 Béziers' },
  edl: { id: 'e1', type, date_edl: '2026-11-15T10:00:00Z', bail_type: 'meuble', bail_date_entree: '2026-11-15', depot_garantie_cents: 104000, realise_par_nom: 'Claire Vidal', remarques_generales: 'Logement repeint avant l’entrée.', date_edl_entree: type === 'sortant' ? '2022-11-02' : null },
  logement: { adresse: '12 rue des Balances', complement: '2e étage', code_postal: '34500', ville: 'Béziers', type_bien: 'appartement', surface_m2: 28.4, meuble: true },
  parties: [
    { id: 'b', role: 'bailleur', represente_id: null, civilite: 'Mme', prenom: 'Claire', nom: 'Vidal', email: 'claire@exemple.fr', telephone: null, adresse: '1 rue A, 34500 Béziers', nouvelle_adresse: null, doit_signer: true },
    { id: 'l', role: 'locataire', represente_id: null, civilite: 'M.', prenom: 'Hugo', nom: 'Marty', email: null, telephone: '0600000000', adresse: null, nouvelle_adresse: type === 'sortant' ? '3 impasse des Lilas, 11800 Trèbes' : null, doit_signer: true },
    { id: 'm', role: 'mandataire_bailleur', represente_id: 'b', civilite: null, prenom: '', nom: 'LOTIER', email: null, telephone: null, adresse: '40 rue Française, 34500 Béziers', nouvelle_adresse: null, doit_signer: false },
  ],
  pieces: [{ id: 'p1', nom: 'Séjour', observations: 'Pièce lumineuse.' }, { id: 'p2', nom: 'Cuisine', observations: null }],
  elements: [
    { id: 'el1', piece_id: 'p1', libelle: 'Sol', nature: 'parquet stratifié', etat: type === 'sortant' ? 'mauvais' : 'bon', fonctionne: null, observations: 'Rayure de 10 cm près de la fenêtre.', detail: null, origine_id: type === 'sortant' ? 'o1' : null },
    { id: 'el2', piece_id: 'p1', libelle: 'Volets / stores', nature: null, etat: 'hors_service', fonctionne: false, observations: 'Sangle effilochée.', detail: null, origine_id: type === 'sortant' ? 'o2' : null },
    { id: 'el3', piece_id: 'p2', libelle: 'Évier', nature: 'inox', etat: 'usage', fonctionne: true, observations: null, detail: null, origine_id: null },
  ],
  origines: { o1: { etat: 'bon', observations: null }, o2: { etat: 'hors_service', observations: 'Déjà bloqué' } },
  compteurs: [
    { type: 'electricite', absent: false, numero: '09451302118760', double_tarif: true, index_1: 18432, index_2: 9877, emplacement: 'Palier' },
    { type: 'eau_froide', absent: false, numero: 'E-1207', double_tarif: false, index_1: 214.5, index_2: null, emplacement: null },
    { type: 'gaz', absent: true, numero: null, double_tarif: false, index_1: null, index_2: null, emplacement: null },
  ],
  cles: [{ nature: 'cle', nombre: 3, destination: 'Porte d’entrée du logement' }, { nature: 'badge', nombre: 1, destination: 'Accès immeuble' }],
  inventaire: [{ libelle: 'Plaques de cuisson', quantite: 1, etat: 'bon' }],
  photos: [
    { id: 'ph2', element_id: 'el3', compteur_type: null, legende: null, pris_le: '2026-11-15T10:20:00Z', latitude: null, longitude: null, octets: JPEG },
    { id: 'ph1', element_id: 'el1', compteur_type: null, legende: 'Rayure près de la fenêtre', pris_le: '2026-11-15T10:05:00Z', latitude: 43.3442, longitude: 3.2158, octets: JPEG },
    { id: 'ph3', element_id: null, compteur_type: 'electricite', legende: null, pris_le: '2026-11-15T10:30:00Z', latitude: null, longitude: null, octets: null },
  ],
});

/** Le texte du PDF, tel qu'un lecteur le voit (outil pdftotext). */
function texte(octets: Uint8Array): string {
  const fichier = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'edl.pdf');
  writeFileSync(fichier, octets);
  return execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
}

describe('PDF de l’état des lieux', () => {
  it('porte les mentions du décret de 2016 pour une entrée', async () => {
    const t = texte(await construirePdf(exemple()));
    for (const attendu of [
      'ÉTAT DES LIEUX D\'ENTRÉE', 'Établi le 15/11/2026 par Claire Vidal',          // type et date
      '12 rue des Balances, 2e étage, 34500 Béziers', '28,4 m² habitables',          // logement
      'Bailleur', 'Mme Claire Vidal', 'Locataire', 'M. Hugo Marty',                  // parties
      'Mandataire du bailleur', 'LOTIER (représente Mme Claire Vidal)',              // mandataires
      'HP 18432 · HC 9877 kWh', '214,5 m³', 'Pas de compteur individuel', 'Non relevé', // compteurs
      'Porte d\'entrée du logement', 'Total remis : 4',                              // clés
      'Séjour', 'parquet stratifié', 'Bon état', 'Rayure de 10 cm', 'Hors service', 'Ne fonctionne pas.', // pièce par pièce
      'Plaques de cuisson', 'Logement repeint',                                      // inventaire, remarques
      'dix jours', 'premier mois de la période de chauffe',                          // complément (art. 3-2)
      'Signatures', 'Lu et approuvé', 'Annexe photographique', 'Photo 1 — Séjour, Sol', '43.34420, 3.21580',
      'Réalisé avec Constatio — partenaire Signabail', 'Page 1 / ',
    ]) expect(t, attendu).toContain(attendu);
    expect(t).not.toContain('APERÇU');
  });
  it('numérote les photos dans l’ordre du document et les cite dans les tableaux', async () => {
    const t = texte(await construirePdf(exemple()));
    expect(t.indexOf('Photo 1 — Séjour, Sol')).toBeLessThan(t.indexOf('Photo 2 — Cuisine, Évier'));
    expect(t).toContain('Photo 3 — Compteur électricité');
    expect(t).toContain('Photo indisponible'); // fichier manquant : signalé, sans faire échouer le document
  });
  it('sortie : colonnes entrée et sortie, nouvelle adresse, date de l’entrée, pas la mention des dix jours', async () => {
    const t = texte(await construirePdf(exemple('sortant')));
    for (const attendu of ['ÉTAT DES LIEUX DE SORTIE', 'État des lieux d\'entrée établi le 02/11/2022', 'Nouvelle adresse : 3 impasse des Lilas, 11800 Trèbes', 'À l\'entrée', 'À la sortie', 'Mauvais état', 'Hors service — Déjà bloqué'])
      expect(t, attendu).toContain(attendu);
    expect(t).not.toContain('dix jours');
  });
  it('l’aperçu est marqué sans valeur sur chaque page', async () => {
    const octets = await construirePdf({ ...exemple(), apercu: true });
    const pages = (await PDFDocument.load(octets)).getPageCount();
    expect(texte(octets).match(/APERÇU SANS VALEUR/g)?.length).toBe(pages);
  });
  it('marque blanche : pas de mention Constatio', async () => {
    expect(texte(await construirePdf({ ...exemple(), mention: null }))).not.toContain('Constatio');
  });
  it('une partie absente ne signe pas, et son absence est écrite', async () => {
    const t = texte(await construirePdf(exemple()));
    expect(t).toContain('absent(e) le jour de l\'état des lieux');
    expect(t.slice(t.indexOf('Signatures'))).not.toContain('LOTIER');
  });
  it('tient un grand logement : plusieurs pages, tableau jamais coupé au milieu d’une ligne', async () => {
    const d = exemple();
    d.pieces = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, nom: `Pièce ${i + 1}`, observations: null }));
    d.elements = d.pieces.flatMap((p) => Array.from({ length: 14 }, (_, j) => ({ id: `${p.id}-${j}`, piece_id: p.id, libelle: `Élément ${j + 1}`, nature: 'matériau', etat: 'bon' as const, fonctionne: null, observations: 'Observation assez longue pour occuper deux lignes dans la colonne prévue, voire trois.', detail: null, origine_id: null })));
    d.photos = Array.from({ length: 14 }, (_, i) => ({ id: `x${i}`, element_id: d.elements[i].id, compteur_type: null, legende: null, pris_le: '2026-11-15T10:00:00Z', latitude: null, longitude: null, octets: JPEG }));
    const octets = await construirePdf(d);
    const pages = (await PDFDocument.load(octets)).getPageCount();
    expect(pages).toBeGreaterThan(6);
    expect(texte(octets)).toContain(`Page ${pages} / ${pages}`);
  });
  it('remplace les caractères que la police ne connaît pas, sans planter', async () => {
    expect(net('L’état → « neuf » 😀 œuvre !')).toBe("L'état -> « neuf » ? œuvre !");
    const d = exemple(); d.elements[0].observations = 'Tache 😀 d’huile → à nettoyer\nsur deux lignes';
    expect(texte(await construirePdf(d))).toContain("d'huile ->");
  });
  it('l’empreinte change si un seul octet change', async () => {
    const a = await construirePdf(exemple());
    const b = Uint8Array.from(a); b[b.length - 10] ^= 1;
    expect(await empreintePdf(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await empreintePdf(b)).not.toBe(await empreintePdf(a));
  });
});
