// Lien de passage Signabail → Constatio, et attestation de rattachement.
//
//   jeton = « <charge JSON en base64url>.<HMAC-SHA256 hex de "<usage>.<charge>"> »
// Le préfixe d'usage (« passage », « rattachement ») empêche de présenter un
// jeton pour un autre usage que le sien. Web Crypto uniquement (Deno et Node).
//
// Décision de sécurité : un compte Constatio qui existe déjà avec la même adresse
// e-mail n'est JAMAIS ouvert sur la seule foi de Signabail. Sinon, il suffirait de
// créer un compte Signabail avec l'adresse de quelqu'un pour entrer chez lui. On
// demande à la personne de se connecter une fois à Constatio pour relier les comptes.

export type Usage = 'passage' | 'rattachement';
export interface Charge { compte: string; email: string; bail: string | null; exp: number }

const hex = (o: ArrayBuffer) => [...new Uint8Array(o)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmac(secret: string, message: string): Promise<string> {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message)));
}
function egales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

export async function emettre(secret: string, usage: Usage, charge: Charge): Promise<string> {
  const c = b64url(JSON.stringify(charge));
  return `${c}.${await hmac(secret, `${usage}.${c}`)}`;
}

/** La charge si le jeton est authentique, du bon usage et non expiré ; sinon le motif du refus. */
export async function lire(secret: string, usage: Usage, jeton: unknown, maintenant = Date.now()): Promise<Charge | 'illisible' | 'faux' | 'perime'> {
  if (typeof jeton !== 'string') return 'illisible';
  const [c, signature, ...reste] = jeton.split('.');
  if (!c || !signature || reste.length) return 'illisible';
  if (!egales(await hmac(secret, `${usage}.${c}`), signature)) return 'faux';
  let charge: Charge;
  try {
    charge = JSON.parse(deb64url(c));
  } catch {
    return 'illisible';
  }
  if (typeof charge.compte !== 'string' || !charge.compte || typeof charge.email !== 'string' || !charge.email || typeof charge.exp !== 'number') return 'illisible';
  return charge.exp * 1000 < maintenant ? 'perime' : { compte: charge.compte, email: charge.email.toLowerCase(), bail: charge.bail ?? null, exp: charge.exp };
}

// ── Décision ──────────────────────────────────────────────────────────────────
// Ce que la fonction serveur doit savoir faire, isolé pour être testé sans Supabase.
export interface Annuaire {
  /** L'adresse du propriétaire de l'organisation déjà reliée à ce compte Signabail. */
  emailDuCompteRelie(compte: string): Promise<string | null>;
  utilisateurExiste(email: string): Promise<boolean>;
  /** Crée l'utilisateur (son organisation suit) et rend l'identifiant de cette organisation. */
  creerUtilisateur(email: string): Promise<string>;
  rattacher(organisationId: string, compte: string): Promise<void>;
  /** Jeton à usage unique qui ouvre une session pour cette adresse. */
  ouvrirSession(email: string): Promise<string>;
  edlDuBail(compte: string, bail: string): Promise<string | null>;
}

export type Issue =
  | { statut: 'session'; session: string; edl: string | null }
  | { statut: 'confirmer'; email: string; attestation: string }
  | { statut: 'refuse'; motif: 'illisible' | 'faux' | 'perime' };

export const DUREE_ATTESTATION_SECONDES = 15 * 60;

export async function traiterPassage(secret: string, jeton: unknown, a: Annuaire, maintenant = Date.now()): Promise<Issue> {
  const charge = await lire(secret, 'passage', jeton, maintenant);
  if (typeof charge === 'string') return { statut: 'refuse', motif: charge };

  // Comptes déjà reliés : on ouvre la session du compte Constatio relié, quelle que soit l'adresse côté Signabail.
  const relie = await a.emailDuCompteRelie(charge.compte);
  if (relie) return { statut: 'session', session: await a.ouvrirSession(relie), edl: charge.bail ? await a.edlDuBail(charge.compte, charge.bail) : null };

  // Un compte Constatio existe avec cette adresse : la personne doit prouver que c'est le sien.
  if (await a.utilisateurExiste(charge.email)) {
    const attestation = await emettre(secret, 'rattachement', { ...charge, exp: Math.floor(maintenant / 1000) + DUREE_ATTESTATION_SECONDES });
    return { statut: 'confirmer', email: charge.email, attestation };
  }

  // Première venue : compte créé, relié, et les messages en attente (bail généré) sont traités.
  const organisation = await a.creerUtilisateur(charge.email);
  await a.rattacher(organisation, charge.compte);
  return { statut: 'session', session: await a.ouvrirSession(charge.email), edl: charge.bail ? await a.edlDuBail(charge.compte, charge.bail) : null };
}

/** Second temps : la personne s'est connectée à Constatio ; on relie SON organisation au compte Signabail. */
export async function traiterRattachement(
  secret: string, attestation: unknown, connecte: { email: string; organisationId: string }, a: Annuaire, maintenant = Date.now(),
): Promise<{ statut: 'rattache'; edl: string | null } | { statut: 'refuse'; motif: 'illisible' | 'faux' | 'perime' | 'autre_compte' }> {
  const charge = await lire(secret, 'rattachement', attestation, maintenant);
  if (typeof charge === 'string') return { statut: 'refuse', motif: charge };
  // L'attestation vaut pour l'adresse qu'elle cite : on ne relie pas le compte Signabail d'un autre.
  if (connecte.email.toLowerCase() !== charge.email) return { statut: 'refuse', motif: 'autre_compte' };
  await a.rattacher(connecte.organisationId, charge.compte);
  return { statut: 'rattache', edl: charge.bail ? await a.edlDuBail(charge.compte, charge.bail) : null };
}
