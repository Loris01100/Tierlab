import { createApi, HttpError, json, type Ctx, type Env } from './api';
import { routesFor } from './community';
import { randomId } from './objects';
import {
  COMMUNITY,
  PUB_RE,
  type CommunityCard,
  type CommunityList,
  type CommunityPage,
  type PreviewTier,
  type PubItem,
  type PublishBody,
  type Published,
} from '../shared/community';
import { cleanBoard, cleanItem, ID_RE, LIVE, type LiveBoard, type LiveItem } from '../shared/live';
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

interface Image {
  type: string;
  data: Uint8Array;
}

interface Cleaned {
  author: string;
  board: LiveBoard;
  images: Map<string, Image>;
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

const CARD_COLS = 'id, title, author, created, updated, tiles, tiers, copies, preview';

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
        img: async (c) => this.#img(c),
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
    const row = PUB_RE.test(id) ? this.#rows(`SELECT ${cols}, reports FROM list WHERE id = ?`, id)[0] : undefined;
    if (!row) throw new HttpError(404, 'Cette liste n’existe pas ou a été retirée');
    if (Number(row.reports) >= COMMUNITY.hideAt) throw new HttpError(404, 'Cette liste a été retirée après des signalements');
    return row;
  }

  #get(ctx: Ctx): CommunityList {
    const row = this.#visible(ctx.params.id, `${CARD_COLS}, board`);
    return { ...toCard(row), board: JSON.parse(String(row.board)) as LiveBoard };
  }

  #img(ctx: Ctx): Response {
    const { id, item } = ctx.params;
    this.#visible(id, 'id');
    const row = ID_RE.test(item) ? this.#rows('SELECT type, data FROM img WHERE list = ? AND id = ?', id, item)[0] : undefined;
    if (!row) return json(404, { error: 'Image introuvable' });
    // Une vignette est immuable (nouvel id à chaque modification) : cache long.
    return new Response(row.data as ArrayBuffer, { headers: { 'Content-Type': String(row.type), 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }

  /** « Faire ma version » : la liste au format d'échange, images en data URL. Compte une copie par adresse. */
  async #copy(ctx: Ctx): Promise<PublishBody['list']> {
    const { id } = ctx.params;
    const row = this.#visible(id, 'board');
    const board = JSON.parse(String(row.board)) as LiveBoard;
    const ip = await ipHash(ctx.request);
    if (this.#sql.exec("INSERT OR IGNORE INTO mark (list, ip, kind) VALUES (?, ?, 'copy')", id, ip).rowsWritten)
      this.#sql.exec('UPDATE list SET copies = copies + 1 WHERE id = ?', id);
    const images = new Map(this.#rows('SELECT id, type, data FROM img WHERE list = ?', id).map((r) => [String(r.id), r]));
    const items: Record<string, PubItem> = {};
    for (const it of board.items) {
      if (it.type === 'text') items[it.id] = { type: 'text', text: it.text, bg: it.bg };
      else {
        const img = images.get(it.id);
        if (img) items[it.id] = { type: 'img', text: it.text, src: `data:${String(img.type)};base64,${toBase64(new Uint8Array(img.data as ArrayBuffer))}` };
      }
    }
    return {
      v: 1,
      title: board.title,
      tiers: board.tiers.map((t) => ({ name: t.name, color: t.color, items: t.items })),
      pool: board.pool,
      items,
    };
  }

  /* ---------- écriture ---------- */

  async #publish(ctx: Ctx): Promise<Published> {
    const ip = await ipHash(ctx.request);
    const data = cleanPublish(await readBody(ctx));
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
    this.#putImages(id, data.images);
    return { id, token };
  }

  async #update(ctx: Ctx): Promise<null> {
    const raw = await readBody(ctx);
    const id = await this.#checkOwner(ctx.params.id, raw.token);
    const data = cleanPublish(raw);
    this.#sql.exec('UPDATE list SET title = ?, author = ?, search = ?, board = ?, preview = ?, tiles = ?, tiers = ?, updated = ? WHERE id = ?', ...listColumns(data), Date.now(), id);
    this.#sql.exec('DELETE FROM img WHERE list = ?', id);
    this.#putImages(id, data.images);
    return null;
  }

  async #remove(ctx: Ctx): Promise<null> {
    const raw = await readBody(ctx);
    const id = await this.#checkOwner(ctx.params.id, raw.token);
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

  #putImages(id: string, images: Map<string, Image>) {
    for (const [item, img] of images) this.#sql.exec('INSERT OR REPLACE INTO img (list, id, type, data) VALUES (?, ?, ?, ?)', id, item, img.type, img.data);
  }
}

/* ---------- utilitaires ---------- */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

async function readBody(ctx: Ctx): Promise<Raw> {
  if (Number(ctx.request.headers.get('Content-Length') ?? 0) > COMMUNITY.body) throw new HttpError(413, 'Liste trop lourde pour être publiée');
  const text = await ctx.request.text();
  if (text.length > COMMUNITY.body) throw new HttpError(413, 'Liste trop lourde pour être publiée');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
  if (!isObj(v)) throw new HttpError(400, 'Liste invalide');
  return v;
}

const IMG_SRC = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

function decodeImage(src: unknown): Image | null {
  const m = typeof src === 'string' ? IMG_SRC.exec(src) : null;
  if (!m || (m[2].length * 3) / 4 > COMMUNITY.image) return null;
  try {
    const bin = atob(m[2]);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return isImage(m[1], data) ? { type: m[1], data } : null;
  } catch {
    return null;
  }
}

/** Vérifie la signature du fichier : la galerie ne doit héberger que de vraies images. */
function isImage(type: string, d: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => d[i + k] === b);
  if (type === 'image/png') return at(0, 0x89, 0x50, 0x4e, 0x47);
  if (type === 'image/jpeg') return at(0, 0xff, 0xd8, 0xff);
  if (type === 'image/gif') return at(0, 0x47, 0x49, 0x46, 0x38);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Valide un corps de publication (données non fiables) : liste au format d'échange + pseudo. */
function cleanPublish(raw: Raw): Cleaned {
  const l = isObj(raw.list) ? raw.list : null;
  if (!l || !Array.isArray(l.tiers) || !isObj(l.items)) throw new HttpError(400, 'Liste invalide');
  const items: LiveItem[] = [];
  const images = new Map<string, Image>();
  for (const [id, v] of Object.entries(l.items)) {
    if (items.length >= LIVE.items) break;
    if (!ID_RE.test(id) || !isObj(v)) continue;
    if (v.type === 'img') {
      const img = images.size < COMMUNITY.images ? decodeImage(v.src) : null;
      if (!img) continue;
      images.set(id, img);
    }
    const it = cleanItem({ ...v, id });
    if (it) items.push(it);
  }
  const tiers = l.tiers.map((t, i) => (isObj(t) ? { ...t, id: `t${i}` } : t));
  const board = cleanBoard({ title: l.title, tiers, pool: l.pool, items });
  if (!board) throw new HttpError(400, 'Liste invalide');
  if (!board.items.length) throw new HttpError(400, 'Ajoutez au moins une vignette avant de publier');
  const used = new Set(board.items.map((i) => i.id));
  for (const id of images.keys()) if (!used.has(id)) images.delete(id);
  const author = typeof raw.author === 'string' ? raw.author.replace(/\s+/g, ' ').trim().slice(0, COMMUNITY.author) : '';
  return { author, board, images };
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
    preview: JSON.parse(String(r.preview)) as PreviewTier[],
  };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Empreinte de l'adresse du client (jamais stockée en clair) ; « local » en dev. */
const ipHash = (r: Request): Promise<string> => sha256(`tierlab:${r.headers.get('CF-Connecting-IP') ?? 'local'}`).then((h) => h.slice(0, 32));
