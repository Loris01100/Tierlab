import { createApi, HttpError, json, type Ctx, type Env } from './api';
import { routesFor } from './community';
import { randomId } from './objects';
import { PACKED, unpackPublish, type Cleaned, type Image } from './publish';
import {
  COMMUNITY,
  PUB_RE,
  type CommunityCard,
  type CommunityList,
  type CommunityPage,
  type PreviewTier,
  type Published,
} from '../shared/community';
import { ID_RE, type LiveBoard } from '../shared/live';
import { fold } from '../shared/rules';

/*
 * Durable Object unique de la galerie communautaire (liaison GALLERY, instance « main »).
 * SQLite : list (une ligne par liste publiée, structure en JSON), img (images en BLOB), mark (copies et
 * signalements, une fois par adresse). Les adresses IP ne sont gardées que sous forme d'empreinte.
 * Pas de comptes : l'auteur reçoit un jeton (stocké ici en SHA-256) pour mettre à jour ou retirer sa liste ;
 * le secret ADMIN_TOKEN, s'il est défini, permet de retirer n'importe quelle liste.
 */

interface SqlCursor {
  toArray(): Record<string, unknown>[];
  readonly rowsWritten: number;
}
interface Sql {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}
export interface GalleryState {
  storage: { sql: Sql };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS list (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, search TEXT NOT NULL,
    board TEXT NOT NULL, preview TEXT NOT NULL, tiles INTEGER NOT NULL, tiers INTEGER NOT NULL, copies INTEGER NOT NULL DEFAULT 0,
    reports INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, token TEXT NOT NULL, ip TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS list_created ON list (created)',
  'CREATE INDEX IF NOT EXISTS list_copies ON list (copies, created)',
  'CREATE INDEX IF NOT EXISTS list_ip ON list (ip, created)',
  'CREATE TABLE IF NOT EXISTS img (list TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (list, id))',
  'CREATE TABLE IF NOT EXISTS mark (list TEXT NOT NULL, ip TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (list, ip, kind))',
];

/** Id réservé de l'image d'aperçu dans la table img : « ~ » est refusé par ID_RE, aucune vignette ne peut le prendre. */
const THUMB = '~thumb';

const CARD_COLS = `id, title, author, created, updated, tiles, tiers, copies, preview,
  EXISTS (SELECT 1 FROM img WHERE img.list = list.id AND img.id = '${THUMB}') AS thumb`;

/** Vérifie qu'une ligne de list (avec sa colonne reports) existe et n'est pas masquée, sinon 404. */
function visibleRow(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) throw new HttpError(404, 'Cette liste n’existe pas ou a été retirée');
  if (Number(row.reports) >= COMMUNITY.hideAt) throw new HttpError(404, 'Cette liste a été retirée après des signalements');
  return row;
}

export class Gallery {
  readonly #sql: Sql;
  readonly #env: Env;
  readonly #handle: (request: Request, env: Env) => Promise<Response | null>;

  constructor(ctx: GalleryState, env: Env) {
    this.#sql = ctx.storage.sql;
    this.#env = env;
    for (const q of SCHEMA) this.#sql.exec(q);
    this.#handle = createApi(
      routesFor({
        list: async (c) => this.#list(c),
        publish: (c) => this.#publish(c),
        get: async (c) => this.#get(c),
        img: async (c) => this.#image(c.params.id, ID_RE.test(c.params.item) ? c.params.item : null),
        thumb: async (c) => this.#image(c.params.id, THUMB),
        copy: (c) => this.#copy(c),
        report: (c) => this.#report(c),
        update: (c) => this.#update(c),
        remove: (c) => this.#remove(c),
      }),
    );
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.#handle(request, this.#env)) ?? json(404, { error: 'Route inconnue' });
  }

  #rows(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    return this.#sql.exec(query, ...bindings).toArray();
  }

  /* ---------- lecture ---------- */

  #list(ctx: Ctx): CommunityPage {
    const popular = ctx.query.get('sort') === 'popular';
    const page = Math.max(0, Math.min(Math.trunc(Number(ctx.query.get('page')) || 0), COMMUNITY.pages - 1));
    const term = fold((ctx.query.get('q') ?? '').trim()).slice(0, 80);
    const where = term ? `AND search LIKE ? ESCAPE '\\'` : '';
    const args: unknown[] = [COMMUNITY.hideAt];
    if (term) args.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    const rows = this.#rows(
      `SELECT ${CARD_COLS} FROM list WHERE reports < ? ${where} ORDER BY ${popular ? 'copies DESC, created DESC' : 'created DESC'} LIMIT ? OFFSET ?`,
      ...args,
      COMMUNITY.page + 1,
      page * COMMUNITY.page,
    );
    return { lists: rows.slice(0, COMMUNITY.page).map(toCard), more: rows.length > COMMUNITY.page && page < COMMUNITY.pages - 1 };
  }

  /** Ligne d'une liste visible (non masquée par les signalements), ou 404. */
  #visible(id: string, cols: string): Record<string, unknown> {
    return visibleRow(PUB_RE.test(id) ? this.#rows(`SELECT ${cols}, reports FROM list WHERE id = ?`, id)[0] : undefined);
  }

  #get(ctx: Ctx): CommunityList {
    const row = this.#visible(ctx.params.id, `${CARD_COLS}, board`);
    return { ...toCard(row), board: JSON.parse(String(row.board)) as LiveBoard };
  }

  /** Image d'une liste visible : une vignette, ou l'aperçu (THUMB). item null = id invalide. */
  #image(id: string, item: string | null): Response {
    // Une seule requête : la liste (visibilité) et l'image jointe, absente (NULL) si l'id ne correspond à rien.
    const row = visibleRow(
      PUB_RE.test(id) && item
        ? this.#rows('SELECT l.reports, i.type, i.data FROM list l LEFT JOIN img i ON i.list = l.id AND i.id = ? WHERE l.id = ?', item, id)[0]
        : undefined,
    );
    if (row.data == null) return json(404, { error: 'Image introuvable' });
    // Une vignette est immuable (nouvel id à chaque modification), l'aperçu est demandé avec ?v=<updated> : cache long.
    return new Response(row.data as ArrayBuffer, { headers: { 'Content-Type': String(row.type), 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }

  /**
   * « Faire ma version » : compte une copie par adresse. Le navigateur construit la copie lui-même avec la liste déjà
   * affichée et ses images (déjà en cache) : rien à relire ni à réencoder ici, la galerie n'est pas bloquée.
   */
  async #copy(ctx: Ctx): Promise<null> {
    const { id } = ctx.params;
    this.#visible(id, 'id');
    const ip = await ipHash(ctx.request);
    if (this.#sql.exec("INSERT OR IGNORE INTO mark (list, ip, kind) VALUES (?, ?, 'copy')", id, ip).rowsWritten)
      this.#sql.exec('UPDATE list SET copies = copies + 1 WHERE id = ?', id);
    return null;
  }

  /* ---------- écriture ---------- */

  async #publish(ctx: Ctx): Promise<Published> {
    const ip = await ipHash(ctx.request);
    const data = await readPacked(ctx);
    const id = randomId(16);
    const token = randomId(32);
    const tokenHash = await sha256(token);
    // Aucune attente à partir d'ici : le Durable Object ne traite pas d'autre requête entre le comptage et l'insertion,
    // sinon des publications envoyées en parallèle passeraient toutes le plafond.
    const now = Date.now();
    const recent = Number(this.#rows('SELECT COUNT(*) AS n FROM list WHERE ip = ? AND created > ?', ip, now - 3_600_000)[0]?.n ?? 0);
    if (recent >= COMMUNITY.perHour) throw new HttpError(429, 'Trop de publications depuis cette connexion : réessayez dans une heure');
    this.#sql.exec(
      `INSERT INTO list (id, title, author, search, board, preview, tiles, tiers, created, updated, token, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ...listColumns(data),
      now,
      now,
      tokenHash,
      ip,
    );
    this.#putImages(id, data);
    return { id, token };
  }

  async #update(ctx: Ctx): Promise<null> {
    const data = await readPacked(ctx);
    const id = await this.#checkOwner(ctx.params.id, data.token);
    this.#sql.exec('UPDATE list SET title = ?, author = ?, search = ?, board = ?, preview = ?, tiles = ?, tiers = ?, updated = ? WHERE id = ?', ...listColumns(data), Date.now(), id);
    this.#sql.exec('DELETE FROM img WHERE list = ?', id);
    this.#putImages(id, data);
    return null;
  }

  async #remove(ctx: Ctx): Promise<null> {
    const id = await this.#checkOwner(ctx.params.id, await readToken(ctx));
    for (const t of ['list WHERE id', 'img WHERE list', 'mark WHERE list']) this.#sql.exec(`DELETE FROM ${t} = ?`, id);
    return null;
  }

  async #report(ctx: Ctx): Promise<null> {
    const { id } = ctx.params;
    this.#visible(id, 'id');
    const ip = await ipHash(ctx.request);
    if (this.#sql.exec("INSERT OR IGNORE INTO mark (list, ip, kind) VALUES (?, ?, 'report')", id, ip).rowsWritten)
      this.#sql.exec('UPDATE list SET reports = reports + 1 WHERE id = ?', id);
    return null;
  }

  /** Vérifie le jeton de l'auteur (ou ADMIN_TOKEN) ; renvoie l'id de la liste. */
  async #checkOwner(id: string, token: unknown): Promise<string> {
    const row = PUB_RE.test(id) ? this.#rows('SELECT token FROM list WHERE id = ?', id)[0] : undefined;
    if (!row) throw new HttpError(404, 'Cette liste n’existe pas ou a été retirée');
    if (typeof token !== 'string' || !token) throw new HttpError(403, 'Seul l’appareil qui a publié cette liste peut la modifier');
    const admin = this.#env.ADMIN_TOKEN;
    if (typeof admin === 'string' && admin.length >= 16 && token === admin) return id;
    if ((await sha256(token)) !== row.token) throw new HttpError(403, 'Seul l’appareil qui a publié cette liste peut la modifier');
    return id;
  }

  #putImages(id: string, { images, thumb }: Cleaned) {
    const all: [string, Image][] = [...images];
    if (thumb) all.push([THUMB, thumb]);
    for (const [item, img] of all) this.#sql.exec('INSERT OR REPLACE INTO img (list, id, type, data) VALUES (?, ?, ?, ?)', id, item, img.type, img.data);
  }
}

/* ---------- utilitaires ---------- */

/** Corps d'une publication ou d'une mise à jour, déjà validé par le Worker (server/publish.ts). */
async function readPacked(ctx: Ctx): Promise<Cleaned> {
  if (ctx.request.headers.get('Content-Type') !== PACKED) throw new HttpError(400, 'Liste invalide');
  return unpackPublish(await ctx.request.arrayBuffer());
}

/** Corps JSON du retrait ({ token }), construit par le Worker. */
async function readToken(ctx: Ctx): Promise<unknown> {
  const v: unknown = await ctx.request.json().catch(() => null);
  return v && typeof v === 'object' ? (v as { token?: unknown }).token : undefined;
}

/** Colonnes title, author, search, board, preview, tiles, tiers (dans cet ordre). */
function listColumns({ author, board }: Cleaned): unknown[] {
  const byId = new Map(board.items.map((i) => [i.id, i]));
  const preview: PreviewTier[] = board.tiers.slice(0, COMMUNITY.previewTiers).map((t) => ({
    name: t.name,
    color: t.color,
    items: t.items.slice(0, COMMUNITY.previewItems).map((id) => {
      const it = byId.get(id);
      return it?.type === 'text' ? { id, type: 'text', bg: it.bg } : { id, type: 'img' };
    }),
  }));
  const title = board.title.trim() || 'Sans titre';
  return [title, author, fold(`${title} ${author}`), JSON.stringify({ ...board, title }), JSON.stringify(preview), board.items.length, board.tiers.length];
}

function toCard(r: Record<string, unknown>): CommunityCard {
  return {
    id: String(r.id),
    title: String(r.title),
    author: String(r.author),
    created: Number(r.created),
    updated: Number(r.updated),
    tiles: Number(r.tiles),
    tiers: Number(r.tiers),
    copies: Number(r.copies),
    thumb: Number(r.thumb) === 1,
    preview: JSON.parse(String(r.preview)) as PreviewTier[],
  };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Empreinte de l'adresse du client (jamais stockée en clair) ; « local » en dev. */
const ipHash = (r: Request): Promise<string> => sha256(`tierlab:${r.headers.get('CF-Connecting-IP') ?? 'local'}`).then((h) => h.slice(0, 32));
