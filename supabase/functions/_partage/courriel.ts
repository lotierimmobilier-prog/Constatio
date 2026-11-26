// Envoi d'un e-mail par la boîte du domaine (SMTP). Sans dépendance : le dialogue SMTP
// tient en quelques lignes, et la composition du message se teste hors réseau.
export interface Boite { hote: string; utilisateur: string; motDePasse: string }
export interface Message { a: string; sujet: string; texte: string; html: string }

const NOM_EXPEDITEUR = 'Constatio';
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

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Mise en page commune : un titre, des paragraphes, un bouton, et la mention de bas de message. */
export function habiller(m: { a: string; sujet: string; titre: string; paragraphes: string[]; bouton?: { libelle: string; adresse: string }; apres?: string[] }): Message {
  const pied = 'Message automatique envoyé par Constatio (constatio.fr), service d’état des lieux édité par la SARL LOTIER, pour le compte de la personne qui a réalisé l’état des lieux. Si vous n’êtes pas concerné, ignorez-le.';
  const texte = [m.titre, '', ...m.paragraphes, ...(m.bouton ? ['', `${m.bouton.libelle} : ${m.bouton.adresse}`] : []), ...(m.apres?.length ? ['', ...m.apres] : []), '', '--', pied].join('\n');
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#0f2f2e">${echapper(s)}</p>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px 12px;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #cfdad7;border-radius:14px;padding:28px 24px">
<p style="margin:0 0 20px;font-size:22px;font-weight:bold;color:#0f4c4a">constatio.fr</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#0f2f2e">${echapper(m.titre)}</h1>
${m.paragraphes.map(p).join('\n')}
${m.bouton ? `<p style="margin:22px 0"><a href="${echapper(m.bouton.adresse)}" style="display:inline-block;background:#f2b61b;color:#2b2000;font-weight:bold;font-size:16px;text-decoration:none;padding:13px 22px;border-radius:10px">${echapper(m.bouton.libelle)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#566b69;word-break:break-all">Si le bouton ne s’ouvre pas, copiez cette adresse dans votre navigateur : ${echapper(m.bouton.adresse)}</p>` : ''}
${(m.apres ?? []).map(p).join('\n')}
<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #cfdad7;font-size:12px;line-height:1.5;color:#566b69">${echapper(pied)}</p>
</div></body></html>`;
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
