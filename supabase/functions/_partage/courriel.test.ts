import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { adresseValide, appelSigne, composer, entete, habiller, messageDeCompte } from './courriel';

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
  it('n’accepte un appel du service de comptes que correctement signé et récent', async () => {
    const cle = Buffer.from('cle-de-test-constatio-0123456789');
    const secret = `v1,whsec_${cle.toString('base64')}`;
    const corps = '{"user":{"email":"a@b.fr"}}';
    const t = 1_795_700_000;
    const signature = `v1,${createHmac('sha256', cle).update(`msg_1.${t}.${corps}`).digest('base64')}`;
    const e = { id: 'msg_1', date: String(t), signature };
    expect(await appelSigne(secret, e, corps, t * 1000)).toBe(true);
    expect(await appelSigne(secret, e, corps + ' ', t * 1000)).toBe(false);
    expect(await appelSigne(secret, e, corps, (t + 301) * 1000)).toBe(false);
    expect(await appelSigne(`v1,whsec_${Buffer.from('autre-cle').toString('base64')}`, e, corps, t * 1000)).toBe(false);
    expect(await appelSigne(secret, { ...e, signature: null }, corps, t * 1000)).toBe(false);
  });
  it('écrit les e-mails de compte en français, avec un lien qui revient sur le site', () => {
    const comptes = 'https://projet.supabase.co/auth/v1', site = 'https://constatio.fr';
    const m = messageDeCompte({ user: { email: 'nouveau@exemple.fr' }, email_data: { token_hash: 'abc123', email_action_type: 'signup', redirect_to: 'https://constatio.fr/app' } }, comptes, site)!;
    expect(m.a).toBe('nouveau@exemple.fr');
    expect(m.sujet).toBe('Confirmez votre adresse e-mail — Constatio');
    expect(m.texte).toContain('https://projet.supabase.co/auth/v1/verify?token=abc123&type=signup&redirect_to=https%3A%2F%2Fconstatio.fr%2Fapp');
    const oubli = messageDeCompte({ user: { email: 'a@b.fr' }, email_data: { token_hash: 'x', email_action_type: 'recovery', redirect_to: 'https://pirate.example/vol' } }, comptes, site)!;
    expect(oubli.texte).toContain('type=recovery&redirect_to=https%3A%2F%2Fconstatio.fr');
    expect(oubli.texte).not.toContain('pirate');
    expect(messageDeCompte({ user: { email: 'a@b.fr', new_email: 'c@d.fr' }, email_data: { token_hash: 'x', token_hash_new: 'y', email_action_type: 'email_change' } }, comptes, site)!.a).toBe('c@d.fr');
    expect(messageDeCompte({ user: { email: 'a@b.fr' }, email_data: { token_hash: 'x', email_action_type: 'inconnu' } }, comptes, site)).toBeNull();
    expect(messageDeCompte({ user: {}, email_data: { token_hash: 'x', email_action_type: 'signup' } }, comptes, site)).toBeNull();
  });
});
