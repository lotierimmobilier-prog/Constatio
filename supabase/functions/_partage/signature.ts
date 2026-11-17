// Signature des messages échangés entre Signabail et Constatio.
//   En-tête : X-Partenaire-Signature: t=<secondes Unix>,v1=<HMAC-SHA256 hexadécimal de « t.corps »>
// Un secret partagé par sens. Le destinataire refuse un message non signé, mal
// signé, ou daté de plus de cinq minutes (rejeu d'un ancien message).
// N'utilise que l'API Web Crypto : le même fichier tourne dans les fonctions
// serveur (Deno) et dans les tests (Node).

export const TOLERANCE_SECONDES = 300;

const hex = (octets: ArrayBuffer) => [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, '0')).join('');

async function hmac(secret: string, message: string): Promise<string> {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message)));
}

/** Comparaison en temps constant : la durée ne révèle pas où les deux chaînes diffèrent. */
function egales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

export async function signer(secret: string, corps: string, maintenant = Date.now()): Promise<string> {
  const t = Math.floor(maintenant / 1000);
  return `t=${t},v1=${await hmac(secret, `${t}.${corps}`)}`;
}

export type Verdict = 'valide' | 'absente' | 'illisible' | 'perimee' | 'fausse';

export async function verifier(secret: string, corps: string, entete: string | null, maintenant = Date.now()): Promise<Verdict> {
  if (!entete) return 'absente';
  const champs = Object.fromEntries(entete.split(',').map((x) => x.trim().split('=') as [string, string]));
  const t = Number(champs.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(champs.v1 ?? '')) return 'illisible';
  if (Math.abs(maintenant / 1000 - t) > TOLERANCE_SECONDES) return 'perimee';
  return egales(await hmac(secret, `${t}.${corps}`), champs.v1) ? 'valide' : 'fausse';
}
