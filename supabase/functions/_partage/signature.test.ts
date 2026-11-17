import { describe, expect, it } from 'vitest';
import { signer, verifier } from './signature';

const SECRET = 'secret-de-test';
const CORPS = '{"id":"evt_1","type":"bail.signe"}';
const T0 = Date.UTC(2026, 10, 17, 15, 0, 0);

describe('signature des messages partenaires', () => {
  it('accepte un message signé avec le bon secret', async () => {
    expect(await verifier(SECRET, CORPS, await signer(SECRET, CORPS, T0), T0 + 2000)).toBe('valide');
  });
  it('refuse un message sans signature ou illisible', async () => {
    expect(await verifier(SECRET, CORPS, null, T0)).toBe('absente');
    expect(await verifier(SECRET, CORPS, 'n-importe-quoi', T0)).toBe('illisible');
    expect(await verifier(SECRET, CORPS, 't=abc,v1=00', T0)).toBe('illisible');
  });
  it('refuse un corps modifié après signature', async () => {
    const entete = await signer(SECRET, CORPS, T0);
    expect(await verifier(SECRET, CORPS.replace('evt_1', 'evt_2'), entete, T0)).toBe('fausse');
  });
  it('refuse un message signé avec un autre secret', async () => {
    expect(await verifier(SECRET, CORPS, await signer('autre-secret', CORPS, T0), T0)).toBe('fausse');
  });
  it('refuse un message rejoué plus de cinq minutes après', async () => {
    const entete = await signer(SECRET, CORPS, T0);
    expect(await verifier(SECRET, CORPS, entete, T0 + 299_000)).toBe('valide');
    expect(await verifier(SECRET, CORPS, entete, T0 + 301_000)).toBe('perimee');
  });
  it('refuse une date maquillée : la date fait partie de ce qui est signé', async () => {
    const entete = await signer(SECRET, CORPS, T0);
    const maquillee = entete.replace(/t=\d+/, `t=${Math.floor((T0 + 3_600_000) / 1000)}`);
    expect(await verifier(SECRET, CORPS, maquillee, T0 + 3_600_000)).toBe('fausse');
  });
});
