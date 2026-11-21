// Magasin local : la copie de travail des états des lieux sur l'appareil.
//
// Principe : tout écran lit et écrit ICI, jamais directement sur le serveur.
//   * une écriture est appliquée tout de suite à la copie locale, puis rangée
//     dans une file d'envoi ;
//   * la file part vers le serveur dans l'ordre, dès qu'il y a du réseau ;
//   * tant que la file n'est pas vide, la copie locale fait foi : on ne la
//     remplace pas par ce que dit le serveur, qui est en retard ;
//   * une écriture que le serveur REFUSE (état des lieux signé entre-temps,
//     droit retiré) est retirée de la file et signalée à l'utilisateur : elle
//     ne bloque pas les suivantes, et elle n'est pas perdue en silence.
// Le transport (appels au serveur) est fourni de l'extérieur : le magasin se
// teste sans réseau ni Supabase.
import { openDB, type IDBPDatabase } from 'idb';

export const TABLES_ENFANTS = ['edl_parties', 'edl_pieces', 'edl_elements', 'edl_compteurs', 'edl_cles', 'edl_inventaire', 'edl_photos'] as const;
export const TABLES = ['logements', 'edl', ...TABLES_ENFANTS] as const;
export type Table = (typeof TABLES)[number];
export type Ligne = Record<string, unknown> & { id: string };

export interface Mutation {
  seq?: number;
  table: Table;
  /** « fichier » : dépôt d'un fichier gardé sur l'appareil ; « retrait_fichier » : sa suppression du serveur. */
  op: 'insert' | 'update' | 'delete' | 'upsert' | 'fichier' | 'retrait_fichier';
  id: string;
  /** insert : la ligne ; update : les champs modifiés ; upsert : la ligne sans son identifiant. */
  donnees?: Record<string, unknown>;
  /** upsert : colonnes qui identifient la ligne côté serveur. */
  conflit?: string;
  /** Libellé lisible, pour dire à l'utilisateur ce qui a été refusé. */
  quoi: string;
}
export type Reponse = 'ok' | 'reseau' | { rejet: string };
export type ContenuEdl = Record<Table, Ligne[]>;

export interface Transport {
  /** `fichier` : le contenu à déposer, pour une mutation « fichier ». */
  envoyer(m: Mutation, fichier?: Blob): Promise<Reponse>;
  /** Tout le contenu d'un état des lieux ; null s'il n'existe plus ou n'est plus accessible. */
  tirerEdl(edlId: string): Promise<ContenuEdl | 'reseau' | null>;
  tirerListe(organisationId: string): Promise<{ edl: Ligne[]; logements: Ligne[] } | 'reseau'>;
}

export interface EtatSync {
  enAttente: number;
  rejets: string[];
}

const FRAICHEUR_MS = 8000;

export class Magasin {
  private db: Promise<IDBPDatabase>;
  private ecouteurs = new Set<() => void>();
  private envoiEnCours: Promise<void> | null = null;
  private tires = new Map<string, number>();
  private etat: EtatSync = { enAttente: 0, rejets: [] };
  /** Avance à chaque écriture locale : sert à écarter une lecture du serveur devenue périmée. */
  private generation = 0;

  constructor(nom: string, private transport: Transport) {
    this.db = openDB(nom, 2, {
      upgrade(db) {
        for (const t of TABLES) {
          if (db.objectStoreNames.contains(t)) continue;
          const s = db.createObjectStore(t, { keyPath: 'id' });
          if (t === 'edl' || t === 'logements') s.createIndex('organisation_id', 'organisation_id');
          else s.createIndex('edl_id', 'edl_id');
          if (t === 'edl_elements') s.createIndex('piece_id', 'piece_id');
        }
        if (!db.objectStoreNames.contains('file')) db.createObjectStore('file', { keyPath: 'seq', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        // Photos gardées sur l'appareil : affichées sans réseau, déposées au retour.
        if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers');
      },
    });
    void this.rafraichirEtat();
  }

  // ── Lecture ────────────────────────────────────────────────────────────────
  async lire<T = Ligne>(table: Table, id: string): Promise<T | undefined> {
    return (await this.db).get(table, id) as Promise<T | undefined>;
  }

  /** Les lignes d'une table pour une valeur d'index, dans l'ordre d'affichage. */
  async lister<T = Ligne>(table: Table, index: 'edl_id' | 'piece_id' | 'organisation_id', valeur: string): Promise<T[]> {
    const lignes = (await (await this.db).getAllFromIndex(table, index, valeur)) as Ligne[];
    const instant = (l: Ligne) => String(l.created_at ?? l._cree ?? '');
    return lignes.sort((a, b) => Number(a.ordre ?? 0) - Number(b.ordre ?? 0) || instant(a).localeCompare(instant(b))) as T[];
  }

  // ── Écriture : locale d'abord, envoyée ensuite ────────────────────────────────
  /** `localSeul` : colonnes que le serveur remplit lui-même (statut…), gardées dans la copie locale sans être envoyées. */
  async inserer(table: Table, lignes: Ligne | Ligne[], quoi: string, localSeul: Record<string, unknown> = {}): Promise<void> {
    const liste = Array.isArray(lignes) ? lignes : [lignes];
    const db = await this.db;
    const tx = db.transaction([table, 'file'], 'readwrite');
    const maintenant = new Date().toISOString();
    for (const l of liste) {
      // « _cree » ne sert qu'au tri local ; il n'est jamais envoyé.
      await tx.objectStore(table).put({ ...localSeul, ...l, _cree: maintenant });
      await tx.objectStore('file').add({ table, op: 'insert', id: l.id, donnees: l, quoi } satisfies Mutation);
    }
    await tx.done;
    await this.apresEcriture();
  }

  async modifier(table: Table, id: string, champs: Record<string, unknown>, quoi: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction([table, 'file'], 'readwrite');
    const actuelle = await tx.objectStore(table).get(id);
    if (actuelle) await tx.objectStore(table).put({ ...actuelle, ...champs });
    await tx.objectStore('file').add({ table, op: 'update', id, donnees: champs, quoi } satisfies Mutation);
    await tx.done;
    await this.apresEcriture();
  }

  /** Crée ou remplace la ligne identifiée par des colonnes métier (un compteur par énergie). */
  async poser(table: Table, cle: Record<string, string>, champs: Record<string, unknown>, quoi: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction([table, 'file'], 'readwrite');
    const voisines = (await tx.objectStore(table).index('edl_id').getAll(cle.edl_id)) as Ligne[];
    const existante = voisines.find((l) => Object.entries(cle).every(([k, v]) => l[k] === v));
    const id = existante?.id ?? crypto.randomUUID();
    await tx.objectStore(table).put({ ...existante, ...cle, ...champs, id, _cree: existante?._cree ?? new Date().toISOString() });
    await tx.objectStore('file').add({ table, op: 'upsert', id, donnees: { ...cle, ...champs }, conflit: Object.keys(cle).join(','), quoi } satisfies Mutation);
    await tx.done;
    await this.apresEcriture();
  }

  // ── Fichiers ───────────────────────────────────────────────────────────────
  /** Garde un fichier sur l'appareil et met son dépôt en file. À appeler AVANT d'insérer la ligne qui le cite. */
  async deposerFichier(id: string, contenu: Blob, chemin: string, quoi: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['fichiers', 'file'], 'readwrite');
    await tx.objectStore('fichiers').put(contenu, id);
    await tx.objectStore('file').add({ table: 'edl_photos', op: 'fichier', id, donnees: { chemin, mime: contenu.type }, quoi } satisfies Mutation);
    await tx.done;
    await this.apresEcriture();
  }
  /** Réservé aux tests : simule des données de navigateur effacées. */
  async effacerFichierPourTest(id: string): Promise<void> {
    await (await this.db).delete('fichiers', id);
  }
  async lireFichier(id: string): Promise<Blob | undefined> {
    return (await this.db).get('fichiers', id) as Promise<Blob | undefined>;
  }
  /** Retire le fichier de l'appareil et met sa suppression du serveur en file. */
  async retirerFichier(id: string, chemin: string, quoi: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['fichiers', 'file'], 'readwrite');
    await tx.objectStore('fichiers').delete(id);
    await tx.objectStore('file').add({ table: 'edl_photos', op: 'retrait_fichier', id, donnees: { chemin }, quoi } satisfies Mutation);
    await tx.done;
    await this.apresEcriture();
  }

  /** Supprime une ligne et, comme le fait la base, tout ce qui en dépend. */
  async supprimer(table: Table, id: string, quoi: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction([...TABLES, 'file'], 'readwrite');
    await tx.objectStore(table).delete(id);
    if (table === 'edl') for (const t of TABLES_ENFANTS) await this.viderIndex(tx.objectStore(t).index('edl_id'), id);
    if (table === 'edl_pieces') await this.viderIndex(tx.objectStore('edl_elements').index('piece_id'), id);
    await tx.objectStore('file').add({ table, op: 'delete', id, quoi } satisfies Mutation);
    await tx.done;
    await this.apresEcriture();
  }

  private async viderIndex(index: { getAllKeys(v: string): Promise<IDBValidKey[]>; objectStore: { delete(k: IDBValidKey): Promise<void> } }, valeur: string) {
    for (const cle of await index.getAllKeys(valeur)) await index.objectStore.delete(cle);
  }

  // ── Envoi de la file ─────────────────────────────────────────────────────────
  /** Vide la file dans l'ordre. S'arrête au premier défaut de réseau ; un refus est retiré et signalé. */
  synchroniser(): Promise<void> {
    this.envoiEnCours ??= this.vider().finally(() => {
      this.envoiEnCours = null;
    });
    return this.envoiEnCours;
  }

  private async vider(): Promise<void> {
    const db = await this.db;
    for (;;) {
      const [m] = (await db.getAll('file', undefined, 1)) as Mutation[];
      if (!m) break;
      let r: Reponse;
      try {
        // Un fichier disparu de l'appareil (données du navigateur effacées) ne peut plus être déposé :
        // on le signale plutôt que de bloquer toute la file.
        const fichier = m.op === 'fichier' ? ((await db.get('fichiers', m.id)) as Blob | undefined) : undefined;
        r = m.op === 'fichier' && !fichier ? { rejet: 'le fichier n’est plus sur cet appareil' } : await this.transport.envoyer(m, fichier);
      } catch {
        r = 'reseau';
      }
      if (r === 'reseau') break;
      await db.delete('file', m.seq!);
      if (r !== 'ok') {
        const rejets = ((await db.get('meta', 'rejets')) as string[] | undefined) ?? [];
        await db.put('meta', [...rejets, `${m.quoi} : ${r.rejet}`], 'rejets');
        // La copie locale contient une écriture refusée : elle sera rechargée dès que la file sera vide.
        this.tires.clear();
      }
      await this.rafraichirEtat();
    }
    await this.rafraichirEtat();
  }

  // ── Rechargement depuis le serveur ───────────────────────────────────────────
  /**
   * Met la copie locale d'un état des lieux à jour. Sans effet s'il reste des
   * écritures à envoyer (la copie locale fait foi) ou s'il n'y a pas de réseau.
   */
  async tirerEdl(edlId: string, force = false): Promise<'a_jour' | 'local' | 'absent'> {
    if (await this.compter()) await this.synchroniser();
    if (await this.compter()) return 'local';
    if (!force && Date.now() - (this.tires.get(edlId) ?? 0) < FRAICHEUR_MS) return 'a_jour';
    const generation = this.generation;
    let contenu: ContenuEdl | 'reseau' | null;
    try {
      contenu = await this.transport.tirerEdl(edlId);
    } catch {
      contenu = 'reseau';
    }
    if (contenu === 'reseau') return 'local';
    // Une saisie a eu lieu pendant la lecture : ce que le serveur a répondu est déjà
    // en retard sur l'appareil. On ne l'applique pas, sous peine d'effacer cette saisie.
    if (generation !== this.generation || (await this.compter())) return 'local';
    const db = await this.db;
    const tx = db.transaction([...TABLES], 'readwrite');
    for (const t of TABLES_ENFANTS) await this.viderIndex(tx.objectStore(t).index('edl_id'), edlId);
    if (contenu === null) {
      await tx.objectStore('edl').delete(edlId);
      await tx.done;
      return 'absent';
    }
    for (const t of TABLES) for (const l of contenu[t]) await tx.objectStore(t).put(l);
    await tx.done;
    this.tires.set(edlId, Date.now());
    return 'a_jour';
  }

  /** Met à jour la liste des états des lieux et des logements du compte (mêmes garde-fous). */
  async tirerListe(organisationId: string): Promise<'a_jour' | 'local'> {
    if (await this.compter()) await this.synchroniser();
    if (await this.compter()) return 'local';
    const generation = this.generation;
    let r: { edl: Ligne[]; logements: Ligne[] } | 'reseau';
    try {
      r = await this.transport.tirerListe(organisationId);
    } catch {
      r = 'reseau';
    }
    if (r === 'reseau') return 'local';
    if (generation !== this.generation || (await this.compter())) return 'local';
    const db = await this.db;
    const tx = db.transaction(['edl', 'logements', ...TABLES_ENFANTS], 'readwrite');
    const connus = new Set(r.edl.map((e) => e.id));
    for (const cle of await tx.objectStore('edl').index('organisation_id').getAllKeys(organisationId)) {
      if (connus.has(cle as string)) continue;
      // Supprimé ailleurs : on retire aussi son contenu local.
      await tx.objectStore('edl').delete(cle);
      for (const t of TABLES_ENFANTS) await this.viderIndex(tx.objectStore(t).index('edl_id'), cle as string);
    }
    for (const e of r.edl) await tx.objectStore('edl').put(e);
    await this.viderIndex(tx.objectStore('logements').index('organisation_id'), organisationId);
    for (const l of r.logements) await tx.objectStore('logements').put(l);
    await tx.done;
    return 'a_jour';
  }

  // ── État, pour l'indicateur à l'écran ─────────────────────────────────────────
  lireEtat = (): EtatSync => this.etat;
  abonner = (f: () => void): (() => void) => {
    this.ecouteurs.add(f);
    return () => this.ecouteurs.delete(f);
  };
  async acquitterRejets(): Promise<void> {
    await (await this.db).delete('meta', 'rejets');
    await this.rafraichirEtat();
  }
  /** À la déconnexion : rien ne doit rester sur un appareil partagé. */
  async effacerTout(): Promise<void> {
    const db = await this.db;
    const tx = db.transaction([...TABLES, 'file', 'meta', 'fichiers'], 'readwrite');
    for (const s of [...TABLES, 'file', 'meta', 'fichiers']) await tx.objectStore(s).clear();
    await tx.done;
    this.tires.clear();
    await this.rafraichirEtat();
  }

  private async compter(): Promise<number> {
    return (await this.db).count('file');
  }
  private async rafraichirEtat(): Promise<void> {
    const db = await this.db;
    const suivant = { enAttente: await db.count('file'), rejets: ((await db.get('meta', 'rejets')) as string[] | undefined) ?? [] };
    if (suivant.enAttente === this.etat.enAttente && suivant.rejets.length === this.etat.rejets.length) return;
    this.etat = suivant;
    this.ecouteurs.forEach((f) => f());
  }
  private async apresEcriture(): Promise<void> {
    this.generation++;
    await this.rafraichirEtat();
    void this.synchroniser(); // sans attendre : l'écran ne dépend jamais du réseau
  }
}
