// Expédie la file des e-mails (table « courriels ») par la boîte du domaine.
//   { action: 'expedier' }   appelée par la base (secret « x-releve ») : à chaque message inscrit, puis toutes les dix minutes.
// Trois messages :
//   document_signe    chaque partie ayant une adresse reçoit le lien personnel de son exemplaire signé ;
//   reserve_deposee   la personne qui a réalisé l'état des lieux est prévenue qu'une réserve attend sa réponse ;
//   reserve_repondue  le locataire est prévenu de la réponse.
// En mode test, rien ne part. Un message en échec est retenté (cinq fois au plus), sans bloquer les autres.
// À déployer sans vérification de session (verify_jwt = false) : la base n'en a pas.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { adresseValide, appelSigne, envoyer, habiller, messageDeCompte, type Boite, type DemandeCompte, type Message } from '../_partage/courriel.ts';

const SITE = (Deno.env.get('SITE_URL') ?? 'https://constatio.fr').replace(/\/+$/, '');
const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const lu = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const TITRES: Record<string, string> = { entrant: 'état des lieux d’entrée', sortant: 'état des lieux de sortie' };
const nom = (p: { civilite: string | null; prenom: string | null; nom: string }) => [p.civilite, p.prenom, p.nom].filter(Boolean).join(' ');
const jour = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

interface Ligne { id: string; edl_id: string; type: 'document_signe' | 'reserve_deposee' | 'reserve_repondue'; reference: string | null; tentatives: number }
interface Partie { id: string; role: string; civilite: string | null; prenom: string | null; nom: string; email: string | null }

/** Crée le lien personnel du document d'une partie (seule l'empreinte du jeton est gardée). */
async function lienDocument(service: SupabaseClient, edl: { id: string; type: string; signe_le: string }, partie: Partie): Promise<{ adresse: string; depot: Date | null }> {
  const jeton = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const limite = new Date(new Date(edl.signe_le).getTime() + 10 * 86_400_000);
  const depot = edl.type === 'entrant' && partie.role === 'locataire' && limite > new Date() ? limite : null;
  lu(await service.from('edl_jetons').insert({ edl_id: edl.id, partie_id: partie.id, usage: 'complement', jeton_hash: hash, expire_le: new Date(Date.now() + 365 * 86_400_000).toISOString(), depot_jusqu_au: depot?.toISOString() ?? null }));
  return { adresse: `${SITE}/reserves/${jeton}`, depot };
}

/** Les messages d'une ligne de la file. Une liste vide : personne à prévenir. */
async function preparer(service: SupabaseClient, l: Ligne): Promise<Message[]> {
  const edl = lu(await service.from('edl').select('id, organisation_id, logement_id, type, statut, date_edl, signe_le, realise_par').eq('id', l.edl_id).single());
  if (edl.statut !== 'signe' || !edl.signe_le) return [];
  const logement = lu(await service.from('logements').select('adresse, code_postal, ville').eq('id', edl.logement_id).single());
  const lieu = `${logement.adresse}, ${logement.code_postal} ${logement.ville}`;
  const quoi = TITRES[edl.type] ?? 'état des lieux';
  const parties = (lu(await service.from('edl_parties').select('id, role, civilite, prenom, nom, email').eq('edl_id', edl.id).order('ordre')) ?? []) as Partie[];

  if (l.type === 'document_signe') {
    const vus = new Set<string>();
    const messages: Message[] = [];
    for (const p of parties) {
      const a = (p.email ?? '').trim().toLowerCase();
      if (!adresseValide(a) || vus.has(a)) continue;
      vus.add(a);
      const lien = await lienDocument(service, edl, p);
      messages.push(habiller({
        a, sujet: `Votre ${quoi} signé — ${lieu}`, titre: `Votre ${quoi} est signé`,
        paragraphes: [`Bonjour ${nom(p)},`, `L’${quoi} du logement situé ${lieu} a été signé par toutes les parties le ${jour(edl.signe_le)}. Votre exemplaire est disponible par le lien personnel ci-dessous, valable un an.`],
        bouton: { libelle: 'Ouvrir mon exemplaire signé', adresse: lien.adresse },
        apres: [
          ...(lien.depot ? [`Vous avez dix jours, jusqu’au ${jour(lien.depot.toISOString())}, pour demander à compléter cet état des lieux d’entrée (loi du 6 juillet 1989, article 3-2). Depuis ce même lien, vous pouvez signaler une réserve en précisant la pièce et en joignant des photos.`] : []),
          'Téléchargez le document et conservez-le pendant toute la durée de la location. Ce lien vous est personnel : ne le transférez pas.',
        ],
      }));
    }
    return messages;
  }

  const reserve = l.reference ? lu(await service.from('edl_complements').select('id, partie_id, piece_id, texte, statut, reponse, photo_paths').eq('id', l.reference).maybeSingle()) : null;
  if (!reserve) return [];
  const auteur = parties.find((p) => p.id === reserve.partie_id);
  const piece = reserve.piece_id ? lu(await service.from('edl_pieces').select('nom').eq('id', reserve.piece_id).maybeSingle())?.nom : null;

  if (l.type === 'reserve_deposee') {
    // Prévenu : la personne qui a réalisé l'état des lieux ; à défaut, les administrateurs du compte.
    const comptes: string[] = edl.realise_par ? [edl.realise_par] : [];
    if (!comptes.length) comptes.push(...((lu(await service.from('organisation_membres').select('user_id, role').eq('organisation_id', edl.organisation_id)) ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'membre').map((m) => m.user_id));
    const adresses = new Set<string>();
    for (const id of comptes.slice(0, 5)) { const u = await service.auth.admin.getUserById(id); const a = u.data.user?.email?.toLowerCase(); if (adresseValide(a)) adresses.add(a); }
    const nb = reserve.photo_paths?.length ?? 0;
    return [...adresses].map((a) => habiller({
      a, sujet: `Réserve à valider — ${lieu}`, titre: 'Une réserve attend votre réponse',
      paragraphes: [
        `${auteur ? nom(auteur) : 'Le locataire'} a déposé une réserve sur l’état des lieux d’entrée du logement situé ${lieu}${piece ? `, pièce « ${piece} »` : ''}${nb ? `, avec ${nb} photo${nb > 1 ? 's' : ''}` : ''} :`,
        `« ${reserve.texte} »`,
        'Vous pouvez l’accepter ou la refuser, avec votre réponse, depuis votre espace. Elle sera reprise dans l’annexe de l’état des lieux.',
      ],
      bouton: { libelle: 'Répondre à cette réserve', adresse: `${SITE}/app/edl/${edl.id}/apercu` },
    }));
  }

  // reserve_repondue : au locataire qui l'a déposée.
  const a = (auteur?.email ?? '').trim().toLowerCase();
  if (!auteur || !adresseValide(a) || reserve.statut === 'demande') return [];
  const lien = await lienDocument(service, edl, auteur);
  return [habiller({
    a, sujet: `Réponse à votre réserve — ${lieu}`, titre: reserve.statut === 'accepte' ? 'Votre réserve a été acceptée' : 'Votre réserve a été refusée',
    paragraphes: [
      `Bonjour ${nom(auteur)},`,
      `Votre réserve${piece ? ` sur la pièce « ${piece} »` : ''} (« ${reserve.texte} ») a été ${reserve.statut === 'accepte' ? 'acceptée' : 'refusée'} par votre bailleur.`,
      ...(reserve.reponse ? [`Sa réponse : « ${reserve.reponse} »`] : []),
    ],
    bouton: { libelle: 'Voir mes réserves et l’annexe', adresse: lien.adresse },
    apres: reserve.statut === 'refuse' ? ['En cas de désaccord, vous pouvez saisir la commission départementale de conciliation (loi du 6 juillet 1989, article 3-2).'] : [],
  })];
}

Deno.serve(async (requete) => {
  if (requete.method !== 'POST') return json(405, { statut: 'refuse' });
  try {
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    // ── E-mail de compte, confié par le service de comptes (appel signé) ───────────────────
    if (requete.headers.has('webhook-signature')) {
      const refus = (code: number, message: string) => json(code, { error: { http_code: code, message } });
      const corps = await requete.text();
      const c = lu(await service.rpc('cles_courriel')) as { utilisateur: string | null; mot_de_passe: string | null; hote: string; comptes_secret: string | null };
      if (!c.comptes_secret || !(await appelSigne(c.comptes_secret, { id: requete.headers.get('webhook-id'), date: requete.headers.get('webhook-timestamp'), signature: requete.headers.get('webhook-signature') }, corps))) return refus(401, 'Appel non reconnu.');
      if (!c.utilisateur || !c.mot_de_passe) return refus(503, 'L’envoi des e-mails n’est pas encore réglé. Réessayez dans quelques minutes.');
      const message = messageDeCompte(JSON.parse(corps) as DemandeCompte, `${Deno.env.get('SUPABASE_URL')!.replace(/\/+$/, '')}/auth/v1`, SITE);
      if (!message) return refus(400, 'Demande non reconnue.');
      try { await envoyer({ hote: c.hote, utilisateur: c.utilisateur, motDePasse: c.mot_de_passe }, message); }
      catch (e) { console.error('courriel de compte', e instanceof Error ? e.message : e); return refus(502, 'Le message n’a pas pu être envoyé. Réessayez dans quelques minutes.'); }
      return json(200, {});
    }
    const attendu = lu(await service.rpc('cle_releve')) as string | null;
    if (!attendu || requete.headers.get('x-releve') !== attendu) return json(401, { statut: 'refuse', motif: 'session' });
    const cles = lu(await service.rpc('cles_courriel')) as { mode_test: boolean; hote: string; utilisateur: string | null; mot_de_passe: string | null };
    const file = (lu(await service.from('courriels').select('id, edl_id, type, reference, tentatives').is('envoye_le', null).lt('tentatives', 5).gt('cree_le', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('cree_le').limit(20)) ?? []) as Ligne[];
    // Boîte pas encore réglée : la file attend, sans consommer ses tentatives.
    if (!cles.mode_test && (!cles.utilisateur || !cles.mot_de_passe)) return json(200, { statut: 'ok', en_attente: file.length, motif: 'messagerie_non_reglee' });
    const boite: Boite = { hote: cles.hote, utilisateur: cles.utilisateur ?? '', motDePasse: cles.mot_de_passe ?? '' };
    let envoyes = 0, echecs = 0;
    for (const l of file) {
      // La ligne est prise avant l'envoi : deux appels simultanés n'envoient pas deux fois le même message.
      const prise = lu(await service.from('courriels').update({ tentatives: l.tentatives + 1 }).eq('id', l.id).eq('tentatives', l.tentatives).is('envoye_le', null).select('id'));
      if (!prise?.length) continue;
      try {
        if (cles.mode_test) { lu(await service.from('courriels').update({ envoye_le: new Date().toISOString(), destinataires: 0, note: 'retenu : mode test' }).eq('id', l.id)); continue; }
        const messages = await preparer(service, l);
        for (const m of messages) await envoyer(boite, m);
        lu(await service.from('courriels').update({ envoye_le: new Date().toISOString(), destinataires: messages.length, note: messages.length ? null : 'aucun destinataire' }).eq('id', l.id));
        if (messages.length) lu(await service.from('edl_journal').insert({ edl_id: l.edl_id, evenement: 'courriel_envoye', details: { type: l.type, destinataires: messages.length } }));
        envoyes += messages.length;
      } catch (e) {
        echecs++;
        console.error('courriel', l.id, e instanceof Error ? e.message : e);
        await service.from('courriels').update({ note: String(e instanceof Error ? e.message : e).slice(0, 300) }).eq('id', l.id);
      }
    }
    return json(200, { statut: 'ok', traites: file.length, envoyes, echecs });
  } catch (e) {
    console.error('courriel', e);
    return json(500, { statut: 'erreur' });
  }
});
