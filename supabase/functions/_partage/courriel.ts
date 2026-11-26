// Envoi d'un e-mail par la boîte du domaine (SMTP). Sans dépendance : le dialogue SMTP
// tient en quelques lignes, et la composition du message se teste hors réseau.
export interface Boite { hote: string; utilisateur: string; motDePasse: string }
export interface Message { a: string; sujet: string; texte: string; html: string }

const NOM_EXPEDITEUR = 'Constatio';
// Le logo et les liens du pied de message pointent toujours vers le site public.
const SITE_PUBLIC = 'https://constatio.fr';
const utf8 = new TextEncoder();
const b64 = (s: string) => { let b = ''; for (const o of utf8.encode(s)) b += String.fromCharCode(o); return btoa(b); };
const lignes76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
/** En-tête contenant autre chose que de l'ASCII : « mot encodé » (RFC 2047), par tranches. */
export function entete(valeur: string): string {
  if (/^[\x20-\x7e]*$/.test(valeur)) return valeur;
  const morceaux: string[] = [];
  let courant = '';
  for (const c of valeur) { if (utf8.encode(courant + c).length > 39) { morceaux.push(courant); courant = ''; } courant += c; }
  if (courant) morceaux.push(courant);
  return morceaux.map((m) => `=?UTF-8?B?${b64(m)}?=`).join('\r\n ');
}
export const adresseValide = (a: unknown): a is string => typeof a === 'string' && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[A-Za-z]{2,}$/.test(a.trim()) && a.length <= 254;

/** Le message complet, prêt à être remis au serveur : texte brut et HTML, en UTF-8. */
export function composer(de: string, m: Message, maintenant = new Date(), identifiant = crypto.randomUUID()): string {
  if (!adresseValide(m.a) || !adresseValide(de)) throw new Error('adresse invalide');
  const limite = `=_constatio_${identifiant.replace(/-/g, '')}`;
  const partie = (type: string, contenu: string) => `--${limite}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lignes76(b64(contenu))}\r\n`;
  return [
    `From: ${NOM_EXPEDITEUR} <${de}>`,
    `To: <${m.a.trim()}>`,
    `Subject: ${entete(m.sujet.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${maintenant.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${identifiant}@${de.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative;\r\n boundary="${limite}"`,
    '',
    partie('text/plain', m.texte) + partie('text/html', m.html) + `--${limite}--`,
    '',
  ].join('\r\n');
}

const echapper = (s: string) => s.replace(/ (?=[:;?!»])/g, '\u00a0').replace(/« /g, '«\u00a0').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Mise en page commune : un titre, des paragraphes, un bouton, et la mention de bas de message. */
export function habiller(m: { a: string; sujet: string; titre: string; paragraphes: string[]; bouton?: { libelle: string; adresse: string }; apres?: string[] }): Message {
  const pied = 'Message automatique envoyé par Constatio (constatio.fr), service d’état des lieux édité par la SARL LOTIER, pour le compte de la personne qui a réalisé l’état des lieux. Si vous n’êtes pas concerné, ignorez-le.';
  const texte = [m.titre, '', ...m.paragraphes, ...(m.bouton ? ['', `${m.bouton.libelle} : ${m.bouton.adresse}`] : []), ...(m.apres?.length ? ['', ...m.apres] : []), '', '--', pied].join('\n');
  // Mise en page en tableaux et styles en ligne : c'est ce que toutes les messageries affichent de la même façon.
  const POLICE = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const p = (s: string) => /^«/.test(s)
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border-left:4px solid #f2b61b;background:#f3f6f5;border-radius:0 8px 8px 0;padding:12px 16px;${POLICE};font-size:16px;line-height:1.55;color:#0f2f2e;font-style:italic">${echapper(s)}</td></tr></table>`
    : `<p style="margin:0 0 16px;${POLICE};font-size:16px;line-height:1.6;color:#0f2f2e">${echapper(s)}</p>`;
  const note = (s: string) => `<p style="margin:0 0 12px;${POLICE};font-size:14px;line-height:1.55;color:#566b69">${echapper(s)}</p>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${echapper(m.sujet)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f6f5">${echapper(m.paragraphes.filter((x) => !/^Bonjour/.test(x))[0] ?? m.titre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f6f5" style="background:#f3f6f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
<tr><td align="left" style="padding:0 6px 18px"><a href="${SITE_PUBLIC}" style="text-decoration:none"><img src="${SITE_PUBLIC}/courriel/logo.png" width="170" height="37" alt="Constatio" style="display:block;border:0;outline:none;${POLICE};font-size:22px;font-weight:bold;color:#0f4c4a"></a></td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #cfdad7;border-radius:16px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td bgcolor="#0f4c4a" style="background:#0f4c4a;padding:26px 30px;border-radius:15px 15px 0 0"><h1 style="margin:0;${POLICE};font-size:24px;line-height:1.25;font-weight:700;color:#ffffff">${echapper(m.titre)}</h1></td></tr>
<tr><td style="padding:28px 30px 10px">
${m.paragraphes.map(p).join('\n')}
${m.bouton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td bgcolor="#f2b61b" style="background:#f2b61b;border-radius:12px"><a href="${echapper(m.bouton.adresse)}" style="display:inline-block;padding:15px 28px;${POLICE};font-size:17px;font-weight:700;color:#2b2000;text-decoration:none;border-radius:12px">${echapper(m.bouton.libelle)}</a></td></tr></table>` : ''}
${(m.apres ?? []).map(note).join('\n')}
</td></tr>
${m.bouton ? `<tr><td style="padding:0 30px 24px"><p style="margin:0;padding-top:14px;border-top:1px solid #e7edeb;${POLICE};font-size:12px;line-height:1.5;color:#566b69">Le bouton ne s’ouvre pas ? Copiez cette adresse dans votre navigateur :<br><a href="${echapper(m.bouton.adresse)}" style="color:#0f4c4a;word-break:break-all">${echapper(m.bouton.adresse)}</a></p></td></tr>` : '<tr><td style="padding:0 0 14px"></td></tr>'}
</table></td></tr>
<tr><td align="center" style="padding:20px 14px 0;${POLICE};font-size:12px;line-height:1.6;color:#566b69">
${echapper(pied)}<br>
<a href="${SITE_PUBLIC}" style="color:#0f4c4a;font-weight:600">constatio.fr</a> &nbsp;·&nbsp; <a href="${SITE_PUBLIC}/mentions-legales/" style="color:#566b69">Mentions légales</a> &nbsp;·&nbsp; <a href="${SITE_PUBLIC}/confidentialite/" style="color:#566b69">Confidentialité</a>
</td></tr>
</table></td></tr></table></body></html>`;
  return { a: m.a, sujet: m.sujet, texte, html };
}

/** Remet un message au serveur de la boîte. Lève une erreur lisible si le serveur refuse. */
export async function envoyer(boite: Boite, m: Message): Promise<void> {
  const [hote, port = '465'] = boite.hote.split(':');
  // Port 465 : chiffré dès la connexion. Un autre port (banc d'essai local) parle en clair.
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const lien: { read(b: Uint8Array): Promise<number | null>; write(b: Uint8Array): Promise<number>; close(): void } =
    port === '465' ? await D.connectTls({ hostname: hote, port: 465 }) : await D.connect({ hostname: hote, port: Number(port) });
  const dec = new TextDecoder();
  let tampon = '';
  const lire = async (): Promise<{ code: number; texte: string }> => {
    for (;;) {
      // Une réponse se termine par une ligne « 250 texte » (espace après le code), les précédentes par « 250-texte ».
      const fin = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(tampon);
      if (fin) { const texte = tampon; tampon = ''; return { code: Number(fin[2]), texte }; }
      const bloc = new Uint8Array(4096);
      const n = await lien.read(bloc);
      if (n === null) throw new Error('connexion fermée par le serveur de messagerie');
      tampon += dec.decode(bloc.subarray(0, n));
    }
  };
  const dire = async (ligne: string, attendu: number, quoi: string) => {
    await lien.write(utf8.encode(`${ligne}\r\n`));
    const r = await lire();
    if (r.code !== attendu) throw new Error(`${quoi} refusé par le serveur de messagerie (${r.code})`);
  };
  try {
    const accueil = await lire();
    if (accueil.code !== 220) throw new Error(`serveur de messagerie indisponible (${accueil.code})`);
    await dire('EHLO constatio.fr', 250, 'salut');
    if (boite.motDePasse) {
      await dire('AUTH LOGIN', 334, 'identification');
      await dire(b64(boite.utilisateur), 334, 'identifiant');
      await dire(b64(boite.motDePasse), 235, 'mot de passe');
    }
    await dire(`MAIL FROM:<${boite.utilisateur}>`, 250, 'expéditeur');
    await dire(`RCPT TO:<${m.a.trim()}>`, 250, 'destinataire');
    await dire('DATA', 354, 'envoi');
    // Une ligne qui commence par un point est doublée (RFC 5321) ; le message se termine par un point seul.
    await dire(`${composer(boite.utilisateur, m).replace(/\r\n\./g, '\r\n..')}\r\n.`, 250, 'message');
    await lien.write(utf8.encode('QUIT\r\n'));
  } finally {
    try { lien.close(); } catch { /* déjà fermée */ }
  }
}

// ── E-mails de compte (confirmation, mot de passe oublié…) confiés par le service de comptes ─────────
/** Vérifie la signature de l'appel (« Standard Webhooks ») : secret « v1,whsec_… », message daté de moins de cinq minutes. */
export async function appelSigne(secret: string, entetes: { id: string | null; date: string | null; signature: string | null }, corps: string, maintenant = Date.now()): Promise<boolean> {
  if (!entetes.id || !entetes.date || !entetes.signature || !/^\d+$/.test(entetes.date)) return false;
  if (Math.abs(maintenant / 1000 - Number(entetes.date)) > 300) return false;
  let cle: Uint8Array;
  try { cle = Uint8Array.from(atob(secret.replace(/^v1,/, '').replace(/^whsec_/, '')), (c) => c.charCodeAt(0)); } catch { return false; }
  const k = await crypto.subtle.importKey('raw', cle as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8.encode(`${entetes.id}.${entetes.date}.${corps}`)));
  let attendu = ''; for (const o of mac) attendu += String.fromCharCode(o);
  attendu = btoa(attendu);
  // Plusieurs signatures possibles, séparées par des espaces ; comparaison sans fuite de durée.
  return entetes.signature.split(' ').some((s) => {
    const recu = s.replace(/^v1,/, '');
    if (recu.length !== attendu.length) return false;
    let d = 0; for (let i = 0; i < recu.length; i++) d |= recu.charCodeAt(i) ^ attendu.charCodeAt(i);
    return d === 0;
  });
}

export interface DemandeCompte { user: { email?: string; new_email?: string }; email_data: { token?: string; token_hash?: string; token_hash_new?: string; redirect_to?: string; email_action_type?: string; site_url?: string } }
/** Le message de compte à envoyer, ou null si la demande n'est pas reconnue. */
export function messageDeCompte(d: DemandeCompte, adresseComptes: string, site: string): Message | null {
  const type = d.email_data?.email_action_type ?? '';
  const a = (type === 'email_change' && d.user?.new_email ? d.user.new_email : d.user?.email ?? '').trim();
  if (!adresseValide(a)) return null;
  // Le retour après le clic reste sur le site : une adresse étrangère est remplacée par l'accueil.
  const retour = d.email_data.redirect_to && d.email_data.redirect_to.startsWith(site) ? d.email_data.redirect_to : site;
  const lien = (jeton: string | undefined, t: string) => `${adresseComptes}/verify?token=${encodeURIComponent(jeton ?? '')}&type=${t}&redirect_to=${encodeURIComponent(retour)}`;
  const jeton = d.email_data.token_hash;
  if (!jeton && type !== 'reauthentication') return null;
  const ignorer = 'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : rien ne changera.';
  switch (type) {
    case 'signup':
      return habiller({ a, sujet: 'Confirmez votre adresse e-mail — Constatio', titre: 'Bienvenue sur Constatio', paragraphes: ['Il reste une étape : confirmez votre adresse e-mail pour ouvrir votre espace et commencer votre premier état des lieux. Le brouillon est gratuit.'], bouton: { libelle: 'Confirmer mon adresse', adresse: lien(jeton, 'signup') }, apres: [ignorer] });
    case 'recovery':
      return habiller({ a, sujet: 'Votre nouveau mot de passe — Constatio', titre: 'Choisir un nouveau mot de passe', paragraphes: ['Vous avez demandé à changer le mot de passe de votre compte Constatio. Le lien ci-dessous est valable une heure et ne sert qu’une fois.'], bouton: { libelle: 'Choisir un nouveau mot de passe', adresse: lien(jeton, 'recovery') }, apres: [ignorer] });
    case 'email_change':
      return habiller({ a, sujet: 'Confirmez votre nouvelle adresse e-mail — Constatio', titre: 'Confirmer votre nouvelle adresse', paragraphes: ['Vous avez demandé à utiliser cette adresse pour votre compte Constatio. Elle deviendra votre identifiant de connexion après confirmation.'], bouton: { libelle: 'Confirmer cette adresse', adresse: lien(d.email_data.token_hash_new || jeton, 'email_change') }, apres: [ignorer] });
    case 'magiclink':
    case 'invite':
      return habiller({ a, sujet: 'Votre lien de connexion — Constatio', titre: 'Ouvrir votre espace Constatio', paragraphes: ['Voici votre lien personnel de connexion. Il ne sert qu’une fois.'], bouton: { libelle: 'Ouvrir mon espace', adresse: lien(jeton, type) }, apres: [ignorer] });
    case 'reauthentication':
      return d.email_data.token ? habiller({ a, sujet: 'Votre code de vérification — Constatio', titre: 'Code de vérification', paragraphes: [`Saisissez ce code pour confirmer l’opération en cours : ${d.email_data.token}`], apres: [ignorer] }) : null;
    default:
      return null;
  }
}
