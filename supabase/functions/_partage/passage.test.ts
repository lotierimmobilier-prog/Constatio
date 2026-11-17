import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emettre, lire, traiterPassage, traiterRattachement, type Annuaire } from './passage';
import { signer, verifier } from './signature';

const SECRET = 'secret-partage';
const T0 = Date.UTC(2026, 10, 17, 15, 0, 0);
const exp = (s: number) => Math.floor(T0 / 1000) + s;

/** Jeton fabriqué exactement comme le fait Signabail (apps/web/src/lib/constatio.ts, crypto de Node). */
function jetonSignabail(p: { compte: string; email: string; bail?: string | null }, secret = SECRET, maintenant = T0) {
  const charge = Buffer.from(JSON.stringify({ ...p, bail: p.bail ?? null, exp: Math.floor(maintenant / 1000) + 60 })).toString('base64url');
  return `${charge}.${createHmac('sha256', secret).update(`passage.${charge}`).digest('hex')}`;
}

class FauxAnnuaire implements Annuaire {
  relies = new Map<string, string>(); // compte Signabail → e-mail Constatio
  utilisateurs = new Set<string>();
  journal: string[] = [];
  async emailDuCompteRelie(compte: string) { return this.relies.get(compte) ?? null; }
  async utilisateurExiste(email: string) { return this.utilisateurs.has(email); }
  async creerUtilisateur(email: string) { this.utilisateurs.add(email); this.journal.push(`cree ${email}`); return `org-${email}`; }
  async rattacher(org: string, compte: string) { this.journal.push(`rattache ${org} ${compte}`); }
  async ouvrirSession(email: string) { this.journal.push(`session ${email}`); return `session-${email}`; }
  async edlDuBail(_compte: string, bail: string) { return `edl-${bail}`; }
}

describe('compatibilité avec Signabail', () => {
  it('lit un jeton de passage émis par Signabail', async () => {
    expect(await lire(SECRET, 'passage', jetonSignabail({ compte: 'ws_1', email: 'Claire@Exemple.fr', bail: 'doc_1' }), T0 + 30_000))
      .toEqual({ compte: 'ws_1', email: 'claire@exemple.fr', bail: 'doc_1', exp: exp(60) });
  });
  it('vérifie un message signé par Signabail', async () => {
    const corps = '{"id":"signabail-bail-doc_1"}';
    const t = Math.floor(T0 / 1000);
    const entete = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${corps}`).digest('hex')}`;
    expect(await verifier(SECRET, corps, entete, T0)).toBe('valide');
    expect(await signer(SECRET, corps, T0)).toBe(entete);
  });
});

describe('jeton de passage', () => {
  it('refuse un jeton expiré, falsifié, d’un autre secret ou d’un autre usage', async () => {
    const jeton = jetonSignabail({ compte: 'ws_1', email: 'a@b.fr' });
    expect(await lire(SECRET, 'passage', jeton, T0 + 61_000)).toBe('perime');
    expect(await lire('autre', 'passage', jeton, T0)).toBe('faux');
    expect(await lire(SECRET, 'rattachement', jeton, T0)).toBe('faux');
    const [charge, signature] = jeton.split('.');
    const autre = Buffer.from(JSON.stringify({ compte: 'ws_VICTIME', email: 'a@b.fr', bail: null, exp: exp(60) })).toString('base64url');
    expect(await lire(SECRET, 'passage', `${autre}.${signature}`, T0)).toBe('faux');
    expect(await lire(SECRET, 'passage', charge, T0)).toBe('illisible');
    expect(await lire(SECRET, 'passage', null, T0)).toBe('illisible');
  });
});

describe('passage', () => {
  it('première venue : compte créé, relié, session ouverte sur le brouillon du bail', async () => {
    const a = new FauxAnnuaire();
    const r = await traiterPassage(SECRET, jetonSignabail({ compte: 'ws_1', email: 'claire@exemple.fr', bail: 'doc_1' }), a, T0);
    expect(r).toEqual({ statut: 'session', session: 'session-claire@exemple.fr', edl: 'edl-doc_1' });
    expect(a.journal).toEqual(['cree claire@exemple.fr', 'rattache org-claire@exemple.fr ws_1', 'session claire@exemple.fr']);
  });
  it('comptes déjà reliés : session du compte Constatio relié, sans rien créer', async () => {
    const a = new FauxAnnuaire();
    a.relies.set('ws_1', 'ancien@exemple.fr');
    const r = await traiterPassage(SECRET, jetonSignabail({ compte: 'ws_1', email: 'nouveau@exemple.fr' }), a, T0);
    expect(r).toEqual({ statut: 'session', session: 'session-ancien@exemple.fr', edl: null });
    expect(a.journal).toEqual(['session ancien@exemple.fr']);
  });
  it('un compte Constatio existe avec cette adresse : aucune session, confirmation demandée', async () => {
    const a = new FauxAnnuaire();
    a.utilisateurs.add('claire@exemple.fr');
    const r = await traiterPassage(SECRET, jetonSignabail({ compte: 'ws_ATTAQUANT', email: 'claire@exemple.fr' }), a, T0);
    expect(r.statut).toBe('confirmer');
    expect(a.journal).toEqual([]); // ni session, ni rattachement
  });
  it('jeton refusé : rien n’est fait', async () => {
    const a = new FauxAnnuaire();
    expect(await traiterPassage(SECRET, jetonSignabail({ compte: 'ws_1', email: 'a@b.fr' }), a, T0 + 120_000)).toEqual({ statut: 'refuse', motif: 'perime' });
    expect(a.journal).toEqual([]);
  });
});

describe('rattachement après connexion', () => {
  const attestation = () => emettre(SECRET, 'rattachement', { compte: 'ws_1', email: 'claire@exemple.fr', bail: 'doc_1', exp: exp(900) });
  it('relie l’organisation de la personne connectée', async () => {
    const a = new FauxAnnuaire();
    expect(await traiterRattachement(SECRET, await attestation(), { email: 'Claire@exemple.fr', organisationId: 'org-9' }, a, T0)).toEqual({ statut: 'rattache', edl: 'edl-doc_1' });
    expect(a.journal).toEqual(['rattache org-9 ws_1']);
  });
  it('refuse si la personne connectée n’est pas celle de l’attestation', async () => {
    const a = new FauxAnnuaire();
    expect(await traiterRattachement(SECRET, await attestation(), { email: 'autre@exemple.fr', organisationId: 'org-2' }, a, T0)).toEqual({ statut: 'refuse', motif: 'autre_compte' });
    expect(a.journal).toEqual([]);
  });
  it('un jeton de passage ne sert pas d’attestation', async () => {
    const a = new FauxAnnuaire();
    expect(await traiterRattachement(SECRET, jetonSignabail({ compte: 'ws_1', email: 'claire@exemple.fr' }), { email: 'claire@exemple.fr', organisationId: 'org-9' }, a, T0)).toEqual({ statut: 'refuse', motif: 'faux' });
  });
  it('l’attestation expire au bout d’un quart d’heure', async () => {
    const a = new FauxAnnuaire();
    expect(await traiterRattachement(SECRET, await attestation(), { email: 'claire@exemple.fr', organisationId: 'org-9' }, a, T0 + 901_000)).toEqual({ statut: 'refuse', motif: 'perime' });
  });
});
