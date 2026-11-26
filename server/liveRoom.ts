import { json } from './api';
import {
  applyOp,
  cleanBoard,
  cleanOp,
  ID_RE,
  IMAGE_TYPES,
  LIVE,
  opItems,
  type ClientMsg,
  type LiveBoard,
  type LiveItem,
  type Op,
  type ServerMsg,
  type Structure,
} from '../shared/live';

/*
 * Durable Object d'une salle d'édition partagée (une instance par lien, voir server/live.ts).
 * Il garde l'état de référence dans son SQLite, applique les opérations dans l'ordre et les relaie par WebSocket.
 * WebSockets « hibernables » : l'objet peut être déchargé entre deux messages, l'état est donc relu depuis SQLite.
 * Ce module ne tourne que dans le runtime Workers (dev : @cloudflare/vite-plugin).
 */

/** Champs utilisés de l'API Durable Objects (types minimaux, sans dépendre de @cloudflare/workers-types). */
interface Socket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
}
interface SqlCursor {
  toArray(): Record<string, unknown>[];
}
export interface RoomState {
  acceptWebSocket(ws: Socket): void;
  getWebSockets(): Socket[];
  storage: { sql: { exec(query: string, ...bindings: unknown[]): SqlCursor } };
}
declare const WebSocketPair: { new (): { 0: Socket; 1: Socket } };

const ACTION = /\/(init|info|ws|img)(?:\/([^/]+))?\/?$/;

/** État d'une salle : la structure et le catalogue des vignettes connues. */
interface Room extends Structure {
  items: Record<string, LiveItem>;
}

export class LiveRoom {
  readonly #ctx: RoomState;
  #room: Room | null;

  constructor(ctx: RoomState) {
    this.#ctx = ctx;
    // Les tables ne sont créées qu'à l'init : un lien inconnu ne laisse rien en stockage.
    const sql = ctx.storage.sql;
    const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
    const row = exists ? sql.exec('SELECT v FROM meta WHERE k = ?', 'room').toArray()[0] : undefined;
    this.#room = row ? (JSON.parse(String(row.v)) as Room) : null;
  }

  async fetch(request: Request): Promise<Response> {
    const m = ACTION.exec(new URL(request.url).pathname);
    if (!m) return json(404, { error: 'Route inconnue' });
    const [, action, sub] = m;

    if (action === 'init') {
      if (this.#room) return json(409, { error: 'Salle déjà créée' });
      const board = cleanBoard(await request.json().catch(() => null));
      if (!board) return json(400, { error: 'Liste invalide' });
      const { items, ...structure } = board;
      const sql = this.#ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
      sql.exec('CREATE TABLE IF NOT EXISTS img (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL)');
      this.#room = { ...structure, items: Object.fromEntries(items.map((i) => [i.id, i])) };
      this.#save();
      return json(200, null);
    }

    if (!this.#room) return json(404, { error: 'Ce lien de partage n’existe pas ou a expiré' });

    if (action === 'info') return json(200, { title: this.#room.title });

    if (action === 'ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json(426, { error: 'WebSocket attendu' });
      const pair = new WebSocketPair();
      this.#ctx.acceptWebSocket(pair[1]);
      send(pair[1], { t: 'state', board: this.#board() });
      this.#peers();
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }

    // action === 'img'
    if (!sub || !ID_RE.test(sub)) return json(400, { error: 'Image invalide' });
    return request.method === 'POST' ? this.#putImage(sub, request) : this.#getImage(sub);
  }

  /* ---------- WebSocket (appelés par le runtime) ---------- */

  webSocketMessage(ws: Socket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > LIVE.message || !this.#room) return;
    let msg: Partial<ClientMsg>;
    try {
      msg = JSON.parse(message) as Partial<ClientMsg>;
    } catch {
      return;
    }
    if (msg.t !== 'op' || typeof msg.n !== 'number') return;
    const op = cleanOp(msg.op);
    // Une opération rejetée est quand même acquittée : le client la retire et se recale sur l'état du serveur.
    if (op) this.#apply(op, ws);
    send(ws, { t: 'ack', n: msg.n });
  }

  webSocketClose(ws: Socket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* déjà fermée */
    }
    this.#peers(ws);
  }

  webSocketError(ws: Socket): void {
    this.#peers(ws);
  }

  /* ---------- interne ---------- */

  #apply(op: Op, from: Socket) {
    const room = this.#room!;
    // Plafond de vignettes : les nouvelles au-delà sont ignorées.
    const left = LIVE.items - Object.keys(room.items).length;
    if (op.k === 'add') op.items = op.items.slice(0, Math.max(0, left));
    else if (opItems(op).length && left <= 0) return;
    for (const it of opItems(op)) room.items[it.id] ??= it;
    applyOp(room, op);
    this.#prune();
    this.#save();
    const out = JSON.stringify({ t: 'op', op } satisfies ServerMsg);
    for (const ws of this.#ctx.getWebSockets()) if (ws !== from) trySend(ws, out);
  }

  /** Oublie les vignettes que la structure n'utilise plus (leurs images restent, elles sont petites). */
  #prune() {
    const room = this.#room!;
    const keep = new Set([...room.pool, ...room.tiers.flatMap((t) => t.items)]);
    for (const id of Object.keys(room.items)) if (!keep.has(id)) delete room.items[id];
  }

  #board(): LiveBoard {
    const { items, ...structure } = this.#room!;
    return { ...structure, items: Object.values(items) };
  }

  #save() {
    this.#ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', 'room', JSON.stringify(this.#room));
  }

  /** Diffuse le nombre de personnes connectées (sans la socket qui se ferme). */
  #peers(closing?: Socket) {
    const all = this.#ctx.getWebSockets().filter((ws) => ws !== closing);
    const out = JSON.stringify({ t: 'peers', n: all.length } satisfies ServerMsg);
    for (const ws of all) trySend(ws, out);
  }

  async #putImage(id: string, request: Request): Promise<Response> {
    const type = request.headers.get('Content-Type') ?? '';
    if (!(IMAGE_TYPES as readonly string[]).includes(type)) return json(415, { error: 'Format d’image non pris en charge' });
    if (Number(request.headers.get('Content-Length') ?? 0) > LIVE.image) return json(413, { error: 'Image trop lourde' });
    const data = await request.arrayBuffer();
    if (data.byteLength > LIVE.image || !data.byteLength) return json(413, { error: 'Image trop lourde' });
    const count = Number(this.#ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM img').toArray()[0]?.n ?? 0);
    if (count >= LIVE.items * 2) return json(429, { error: 'Trop d’images dans cette liste' });
    // Une vignette est immuable : la première image reçue pour un id fait foi.
    this.#ctx.storage.sql.exec('INSERT OR IGNORE INTO img (id, type, data) VALUES (?, ?, ?)', id, type, data);
    return json(200, null);
  }

  #getImage(id: string): Response {
    const row = this.#ctx.storage.sql.exec('SELECT type, data FROM img WHERE id = ?', id).toArray()[0];
    if (!row) return json(404, { error: 'Image introuvable' });
    return new Response(row.data as ArrayBuffer, {
      headers: { 'Content-Type': String(row.type), 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  }
}

function trySend(ws: Socket, data: string) {
  try {
    ws.send(data);
  } catch {
    /* socket en cours de fermeture */
  }
}

const send = (ws: Socket, msg: ServerMsg) => trySend(ws, JSON.stringify(msg));
