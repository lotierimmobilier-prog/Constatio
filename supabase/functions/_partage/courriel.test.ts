import { describe, expect, it } from 'vitest';
import { adresseValide, composer, entete, habiller } from './courriel';

const decoder = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));

describe('courriel', () => {
  it('refuse une adresse qui permettrait d’injecter un en-tête ou un second destinataire', () => {
    for (const a of ['a@b.fr\r\nBcc: x@y.fr', 'a@b.fr, c@d.fr', 'a b@c.fr', '<a@b.fr>', 'sans-arobase', '']) expect(adresseValide(a), a).toBe(false);
    expect(adresseValide('hugo.marty+edl@exemple.fr')).toBe(true);
    expect(() => composer('bonjour@constatio.fr', { a: 'a@b.fr\r\nBcc: x@y.fr', sujet: 's', texte: 't', html: 'h' })).toThrow();
  });
  it('encode les accents de l’objet et ne laisse passer aucun retour à la ligne', () => {
    expect(entete('Votre document')).toBe('Votre document');
    const e = entete('État des lieux signé — 8 rue de la Signature, 34500 Béziers');
    expect(e).toMatch(/^=\?UTF-8\?B\?/);
    for (const l of e.split('\r\n ')) expect(l.length).toBeLessThanOrEqual(75);
    expect(e.split('\r\n ').map((m) => decoder(m.slice(10, -2))).join('')).toBe('État des lieux signé — 8 rue de la Signature, 34500 Béziers');
    expect(composer('bonjour@constatio.fr', { a: 'a@b.fr', sujet: 'Objet\r\nBcc: x@y.fr', texte: 't', html: 'h' })).not.toMatch(/\r\nBcc:/);
  });
  it('compose un message en deux versions, texte et HTML, lisibles par toute messagerie', () => {
    const m = habiller({ a: 'hugo@exemple.fr', sujet: 'État des lieux signé', titre: 'Votre état des lieux est signé', paragraphes: ['Bonjour <Hugo> & Cie,'], bouton: { libelle: 'Ouvrir', adresse: 'https://constatio.fr/reserves/abc' } });
    expect(m.html).toContain('Bonjour &lt;Hugo&gt; &amp; Cie,');
    expect(m.texte).toContain('Ouvrir : https://constatio.fr/reserves/abc');
    const brut = composer('bonjour@constatio.fr', m, new Date('2026-11-26T10:00:00Z'), '11111111-2222-3333-4444-555555555555');
    expect(brut).toContain('From: Constatio <bonjour@constatio.fr>\r\nTo: <hugo@exemple.fr>\r\n');
    expect(brut).toContain('Date: Thu, 26 Nov 2026 10:00:00 +0000');
    expect(brut).toContain('Message-ID: <11111111-2222-3333-4444-555555555555@constatio.fr>');
    const parties = brut.split('--=_constatio_11111111222233334444555555555555');
    expect(parties).toHaveLength(4);
    expect(parties[1]).toContain('text/plain');
    expect(decoder(parties[1].split('\r\n\r\n')[1])).toContain('Votre état des lieux est signé');
    expect(decoder(parties[2].split('\r\n\r\n')[1])).toContain('<h1');
    for (const l of brut.split('\r\n')) expect(l.length).toBeLessThanOrEqual(78);
  });
});
