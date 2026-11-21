import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Magasin, TABLES, type ContenuEdl, type Ligne, type Mutation, type Reponse, type Transport } from './magasin';

/** Faux serveur : mémorise ce qu'il reçoit, et se laisse couper ou rendre grincheux. */
class FauxServeur implements Transport {
  recus: Mutation[] = [];
  enLigne = true;
  refuser: (m: Mutation) => string | null = () => null;
  contenu: ContenuEdl | null = null;
  liste: { edl: Ligne[]; logements: Ligne[] } = { edl: [], logements: [] };
  fichiers: string[] = [];
  async envoyer(m: Mutation, fichier?: Blob): Promise<Reponse> {
    if (!this.enLigne) return 'reseau';
    if (m.op === 'fichier') this.fichiers.push(`${(m.donnees as { chemin: string }).chemin} (${fichier?.size} octets)`);
    const motif = this.refuser(m);
    if (motif) return { rejet: motif };
    this.recus.push(m);
    return 'ok';
  }
  async tirerEdl() { return this.enLigne ? this.contenu : ('reseau' as const); }
  async tirerListe() { return this.enLigne ? this.liste : ('reseau' as const); }
}
const vide = (): ContenuEdl => Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as ContenuEdl;
const piece = (id: string, edl = 'e1', ordre = 0): Ligne => ({ id, edl_id: edl, nom: id, ordre });
const element = (id: string, pieceId: string, edl = 'e1'): Ligne => ({ id, edl_id: edl, piece_id: pieceId, etat: null, ordre: 0 });

let n = 0;
let serveur: FauxServeur;
let m: Magasin;
beforeEach(() => {
  serveur = new FauxServeur();
  m = new Magasin(`test-${++n}`, serveur);
});

describe('hors connexion', () => {
  it('garde les saisies localement et les envoie dans l’ordre au retour du réseau', async () => {
    serveur.enLigne = false;
    await m.inserer('edl_pieces', piece('p1'), 'Séjour');
    await m.inserer('edl_elements', element('el1', 'p1'), 'Sol');
    await m.modifier('edl_elements', 'el1', { etat: 'bon' }, 'Sol');
    await m.synchroniser();
    expect(serveur.recus).toHaveLength(0);
    expect(m.lireEtat().enAttente).toBe(3);
    // La copie locale reflète déjà la saisie.
    expect((await m.lire<Ligne>('edl_elements', 'el1'))?.etat).toBe('bon');

    serveur.enLigne = true;
    await m.synchroniser();
    expect(serveur.recus.map((x) => `${x.op} ${x.table} ${x.id}`)).toEqual(['insert edl_pieces p1', 'insert edl_elements el1', 'update edl_elements el1']);
    expect(m.lireEtat().enAttente).toBe(0);
  });

  it('n’envoie jamais les champs locaux', async () => {
    await m.inserer('edl_pieces', piece('p1'), 'Séjour');
    await m.synchroniser();
    expect(serveur.recus[0].donnees).toEqual(piece('p1'));
    expect((await m.lire<Ligne>('edl_pieces', 'p1'))?._cree).toBeTruthy();
  });

  it('ne remplace pas la copie locale par le serveur tant qu’il reste des envois', async () => {
    serveur.enLigne = false;
    await m.inserer('edl_pieces', piece('p1'), 'Séjour');
    serveur.contenu = vide(); // le serveur, en retard, ne connaît pas encore la pièce
    expect(await m.tirerEdl('e1')).toBe('local');
    expect(await m.lister('edl_pieces', 'edl_id', 'e1')).toHaveLength(1);
  });

  it('une lecture du serveur dépassée par une saisie n’écrase pas cette saisie', async () => {
    await m.inserer('edl_elements', element('el1', 'p1'), 'Sol');
    await m.synchroniser();
    // Le serveur répond avec l'ancien état… pendant que l'utilisateur vient de saisir « bon ».
    serveur.tirerEdl = async () => {
      await m.modifier('edl_elements', 'el1', { etat: 'bon' }, 'Sol');
      return { ...vide(), edl: [{ id: 'e1', organisation_id: 'o1' }], edl_elements: [element('el1', 'p1')] };
    };
    expect(await m.tirerEdl('e1', true)).toBe('local');
    expect((await m.lire<Ligne>('edl_elements', 'el1'))?.etat).toBe('bon');
  });

  it('recharge depuis le serveur une fois la file vide, et retire ce qui a disparu', async () => {
    await m.inserer('edl_pieces', [piece('p1'), piece('p2', 'e1', 1)], 'Pièces');
    await m.synchroniser();
    serveur.contenu = { ...vide(), edl: [{ id: 'e1', organisation_id: 'o1' }], edl_pieces: [piece('p2', 'e1', 1)] };
    expect(await m.tirerEdl('e1', true)).toBe('a_jour');
    expect((await m.lister<Ligne>('edl_pieces', 'edl_id', 'e1')).map((p) => p.id)).toEqual(['p2']);
  });

  it('un état des lieux supprimé ailleurs disparaît de l’appareil', async () => {
    await m.inserer('edl', { id: 'e1', organisation_id: 'o1' }, 'EDL');
    await m.inserer('edl_pieces', piece('p1'), 'Séjour');
    await m.synchroniser();
    serveur.contenu = null;
    expect(await m.tirerEdl('e1', true)).toBe('absent');
    expect(await m.lire('edl', 'e1')).toBeUndefined();
    expect(await m.lister('edl_pieces', 'edl_id', 'e1')).toHaveLength(0);
  });
});

describe('photos', () => {
  const photo = new Blob(['0123456789'], { type: 'image/jpeg' });
  it('la photo est gardée sur l’appareil, puis déposée avant la ligne qui la cite', async () => {
    serveur.enLigne = false;
    await m.deposerFichier('ph1', photo, 'o1/e1/photos/ph1.jpg', 'Photo');
    await m.inserer('edl_photos', { id: 'ph1', edl_id: 'e1', storage_path: 'o1/e1/photos/ph1.jpg' }, 'Photo');
    expect((await m.lireFichier('ph1'))?.size).toBe(10); // visible sans réseau
    expect(m.lireEtat().enAttente).toBe(2);
    serveur.enLigne = true;
    await m.synchroniser();
    expect(serveur.fichiers).toEqual(['o1/e1/photos/ph1.jpg (10 octets)']);
    expect(serveur.recus.map((x) => x.op)).toEqual(['fichier', 'insert']);
    expect((await m.lireFichier('ph1'))?.size).toBe(10); // reste en cache après le dépôt
  });
  it('retirer une photo l’enlève de l’appareil et du serveur', async () => {
    await m.deposerFichier('ph1', photo, 'o1/e1/photos/ph1.jpg', 'Photo');
    await m.inserer('edl_photos', { id: 'ph1', edl_id: 'e1', storage_path: 'o1/e1/photos/ph1.jpg' }, 'Photo');
    await m.supprimer('edl_photos', 'ph1', 'Photo');
    await m.retirerFichier('ph1', 'o1/e1/photos/ph1.jpg', 'Photo');
    await m.synchroniser();
    expect(await m.lireFichier('ph1')).toBeUndefined();
    expect(serveur.recus.map((x) => x.op)).toEqual(['fichier', 'insert', 'delete', 'retrait_fichier']);
  });
  it('un fichier disparu de l’appareil est signalé, sans bloquer la suite', async () => {
    serveur.enLigne = false;
    await m.deposerFichier('ph1', photo, 'o1/e1/photos/ph1.jpg', 'Photo du séjour');
    await m.inserer('edl_pieces', piece('p9'), 'Cave');
    await m.effacerFichierPourTest('ph1');
    serveur.enLigne = true;
    await m.synchroniser();
    expect(m.lireEtat().rejets).toEqual(['Photo du séjour : le fichier n’est plus sur cet appareil']);
    expect(serveur.recus.map((x) => x.op)).toEqual(['insert']);
  });
});

describe('refus du serveur', () => {
  it('une écriture refusée est signalée, sans bloquer les suivantes', async () => {
    serveur.refuser = (x) => (x.id === 'el1' ? 'État des lieux signé : il ne peut plus être modifié.' : null);
    serveur.enLigne = false;
    await m.modifier('edl_elements', 'el1', { etat: 'neuf' }, 'Sol');
    await m.modifier('edl_elements', 'el2', { etat: 'bon' }, 'Murs');
    serveur.enLigne = true;
    await m.synchroniser();
    expect(serveur.recus.map((x) => x.id)).toEqual(['el2']);
    expect(m.lireEtat()).toEqual({ enAttente: 0, rejets: ['Sol : État des lieux signé : il ne peut plus être modifié.'] });
    await m.acquitterRejets();
    expect(m.lireEtat().rejets).toEqual([]);
  });

  it('une erreur inattendue du transport vaut défaut de réseau : rien n’est perdu', async () => {
    serveur.envoyer = async () => { throw new Error('boum'); };
    await m.modifier('edl_elements', 'el1', { etat: 'neuf' }, 'Sol');
    await m.synchroniser();
    expect(m.lireEtat().enAttente).toBe(1);
  });
});

describe('copie locale', () => {
  it('supprimer une pièce retire ses éléments ; supprimer l’EDL retire tout', async () => {
    await m.inserer('edl', { id: 'e1', organisation_id: 'o1' }, 'EDL');
    await m.inserer('edl_pieces', [piece('p1'), piece('p2', 'e1', 1)], 'Pièces');
    await m.inserer('edl_elements', [element('a', 'p1'), element('b', 'p2')], 'Éléments');
    await m.supprimer('edl_pieces', 'p1', 'Séjour');
    expect((await m.lister<Ligne>('edl_elements', 'edl_id', 'e1')).map((x) => x.id)).toEqual(['b']);
    await m.supprimer('edl', 'e1', 'EDL');
    expect(await m.lister('edl_pieces', 'edl_id', 'e1')).toHaveLength(0);
    expect(await m.lister('edl_elements', 'edl_id', 'e1')).toHaveLength(0);
  });

  it('un compteur par énergie : poser deux fois ne crée qu’une ligne', async () => {
    await m.poser('edl_compteurs', { edl_id: 'e1', type: 'gaz' }, { absent: true }, 'Gaz');
    await m.poser('edl_compteurs', { edl_id: 'e1', type: 'gaz' }, { absent: false, index_1: 12 }, 'Gaz');
    const lignes = await m.lister<Ligne>('edl_compteurs', 'edl_id', 'e1');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ type: 'gaz', absent: false, index_1: 12 });
    await m.synchroniser();
    expect(serveur.recus.at(-1)).toMatchObject({ op: 'upsert', conflit: 'edl_id,type', donnees: { edl_id: 'e1', type: 'gaz', absent: false, index_1: 12 } });
  });

  it('trie par ordre puis par date de création', async () => {
    await m.inserer('edl_pieces', piece('b', 'e1', 1), 'b');
    await m.inserer('edl_pieces', piece('a', 'e1', 0), 'a');
    expect((await m.lister<Ligne>('edl_pieces', 'edl_id', 'e1')).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('la déconnexion efface tout de l’appareil', async () => {
    serveur.enLigne = false;
    await m.inserer('edl_pieces', piece('p1'), 'Séjour');
    await m.effacerTout();
    expect(await m.lister('edl_pieces', 'edl_id', 'e1')).toHaveLength(0);
    expect(m.lireEtat().enAttente).toBe(0);
  });

  it('la liste du compte suit le serveur', async () => {
    await m.inserer('edl', [{ id: 'e1', organisation_id: 'o1' }, { id: 'e2', organisation_id: 'o1' }], 'EDL');
    await m.inserer('edl_pieces', piece('p1', 'e2'), 'Séjour');
    await m.synchroniser();
    serveur.liste = { edl: [{ id: 'e1', organisation_id: 'o1' }], logements: [{ id: 'l1', organisation_id: 'o1' }] };
    expect(await m.tirerListe('o1')).toBe('a_jour');
    expect((await m.lister<Ligne>('edl', 'organisation_id', 'o1')).map((x) => x.id)).toEqual(['e1']);
    expect(await m.lister('edl_pieces', 'edl_id', 'e2')).toHaveLength(0);
    expect(await m.lister('logements', 'organisation_id', 'o1')).toHaveLength(1);
  });
});
