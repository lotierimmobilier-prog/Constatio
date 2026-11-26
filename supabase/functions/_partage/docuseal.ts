// Signature électronique par DocuSeal, sur le modèle de Signabail (mêmes appels, même clé).
// Fonctions pures pour la mise en forme, et trois appels : créer la demande, lire son état,
// rapatrier le document signé.
import type { CaseSignature } from './pdf.ts';

export interface Signataire { partie_id: string; role: string; nom: string; email: string }
export interface ConfigDocuseal { cle: string; url: string }
const A4 = { l: 595.28, h: 841.89 };

/** L'adresse où le signataire signe : celle de l'application, déduite de celle de l'API. */
export const adresseApp = (api: string) => api.replace(/\/+$/, '').replace('://api.', '://').replace(/\/api$/, '');

/**
 * Cases du PDF → champs DocuSeal : fractions de page, origine en HAUT, pages comptées à partir de 1,
 * chaque champ rattaché au rôle de son signataire (convention vérifiée en production par Signabail et Collab).
 */
export function champsDepuisCases(cases: CaseSignature[], signataires: Signataire[]) {
  return cases.flatMap((c) => {
    const s = signataires.find((x) => x.partie_id === c.partie_id);
    return s ? [{ name: 'Signature', type: 'signature' as const, role: s.role,
      areas: [{ x: c.x / A4.l, y: (A4.h - c.y - c.hauteur) / A4.h, w: c.largeur / A4.l, h: c.hauteur / A4.h, page: c.page + 1 }] }] : [];
  });
}

/** État du prestataire → où en est la demande. Un état inconnu reste « en attente », jamais « signé ». */
export function statutDepuisPrestataire(statut: string): 'en_signature' | 'signee' | 'annulee' {
  if (statut === 'completed') return 'signee';
  if (['declined', 'expired', 'canceled', 'archived'].includes(statut)) return 'annulee';
  return 'en_signature';
}

async function appel(cfg: ConfigDocuseal, chemin: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(`${cfg.url.replace(/\/+$/, '')}${chemin}`, { ...init, headers: { 'X-Auth-Token': cfg.cle, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`DocuSeal ${r.status} : ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r;
}
const base64 = (o: Uint8Array) => { let t = ''; for (let i = 0; i < o.length; i += 8192) t += String.fromCharCode(...o.subarray(i, i + 8192)); return btoa(t); };

export interface Demande { id: string; liens: { partie_id: string; email: string; url: string }[] }
/** Crée la demande : chaque partie reçoit un e-mail de DocuSeal avec son lien de signature. */
export async function creerDemande(cfg: ConfigDocuseal, d: { nom: string; pdf: Uint8Array; signataires: Signataire[]; cases: CaseSignature[]; message: { subject: string; body: string } }): Promise<Demande> {
  const r = await appel(cfg, '/submissions/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    name: d.nom, order: 'random', send_email: true,
    documents: [{ name: d.nom, file: base64(d.pdf), fields: champsDepuisCases(d.cases, d.signataires) }],
    submitters: d.signataires.map((s) => ({ role: s.role, email: s.email, name: s.nom || undefined })),
    message: d.message,
  }) });
  type Cree = { submission_id?: number; id?: number; email?: string; slug?: string | null; embed_src?: string | null };
  const j = (await r.json()) as Cree[] | Cree;
  const liste = Array.isArray(j) ? j : [j];
  const id = String(liste[0]?.submission_id ?? liste[0]?.id ?? '');
  if (!id) throw new Error('DocuSeal n’a pas renvoyé d’identifiant de demande.');
  const app = adresseApp(cfg.url);
  return { id, liens: liste.flatMap((s) => {
    const partie = d.signataires.find((x) => x.email.toLowerCase() === (s.email ?? '').toLowerCase());
    const url = /^https?:\/\//i.test(s.embed_src ?? '') ? s.embed_src! : s.slug ? `${app}/s/${encodeURIComponent(s.slug)}` : null;
    return partie && url ? [{ partie_id: partie.partie_id, email: partie.email, url }] : [];
  }) };
}

export async function etatDemande(cfg: ConfigDocuseal, id: string): Promise<{ statut: string; signataires: { email: string; signe: boolean }[] }> {
  const j = (await (await appel(cfg, `/submissions/${encodeURIComponent(id)}`)).json()) as { status?: string; submitters?: { email?: string; status?: string; completed_at?: string | null }[] };
  return { statut: j.status ?? 'inconnu', signataires: (j.submitters ?? []).map((s) => ({ email: s.email ?? '', signe: s.status === 'completed' || !!s.completed_at })) };
}

/** Le PDF signé, rapatrié chez nous : une archive ne vit pas que chez le prestataire. */
export async function telechargerSigne(cfg: ConfigDocuseal, id: string): Promise<Uint8Array> {
  const j = (await (await appel(cfg, `/submissions/${encodeURIComponent(id)}/documents`)).json()) as { documents?: { url?: string }[] } | { url?: string }[];
  const url = (Array.isArray(j) ? j : (j.documents ?? [])).map((x) => x.url).find(Boolean);
  if (!url) throw new Error('DocuSeal n’a renvoyé aucun document signé.');
  const f = await fetch(url);
  if (!f.ok) throw new Error(`Document signé non récupéré (HTTP ${f.status}).`);
  return new Uint8Array(await f.arrayBuffer());
}
