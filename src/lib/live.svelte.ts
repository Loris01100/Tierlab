import { applyOp, opItems, type ClientMsg, type LiveBoard, type LiveItem, type Op, type ServerMsg, type Structure } from '../../shared/live';
import { ApiError, apiGet, apiPost, mapLimit } from './api';
import type { Editor } from './editor.svelte';
import { toast } from './toast.svelte';
import type { Item } from './types';
import { fgFor } from './utils';

/**
 * Lien d'édition partagée d'une liste ouverte (un par Editor, voir Editor.goLive).
 *
 * Modèle : le serveur fait foi. On garde son état confirmé (`#confirmed`) et nos opérations pas encore acquittées
 * (`#pending`). L'état affiché vaut toujours confirmé + en attente : à chaque opération reçue d'un autre client,
 * on recalcule et on le passe à l'éditeur (Editor.adopt). Les opérations étant idempotentes (shared/live.ts),
 * celles restées en attente sont simplement renvoyées après une reconnexion.
 * Les images partent avant l'opération qui les référence, pour que les autres les trouvent déjà sur le serveur.
 */

export type LiveStatus = 'connecting' | 'online' | 'offline' | 'gone';

interface Pending {
  n: number;
  op: Op;
  /** Images envoyées : l'opération peut partir. */
  ready: boolean;
  sent: boolean;
}

const imgPath = (room: string, id: string): string => `/live/${room}/img/${id}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const toLive = (it: Item): LiveItem =>
  it.type === 'img' ? { id: it.id, type: 'img', text: it.text } : { id: it.id, type: 'text', text: it.text, bg: it.bg };

export const fromLive = (it: LiveItem, listId: string): Item =>
  it.type === 'img' ? { id: it.id, listId, type: 'img', text: it.text } : { id: it.id, listId, type: 'text', text: it.text, bg: it.bg, fg: fgFor(it.bg ?? '#3d5afe') };

/** Envoie une image, avec deux nouvelles tentatives en cas d'échec réseau ou serveur. */
async function upload(room: string, id: string, blob: Blob): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await apiPost(imgPath(room, id), blob);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) return false;
      await wait(1000 * (i + 1));
    }
  }
  return false;
}

/** Crée une salle à partir de la liste ouverte et y envoie ses images. Renvoie l'id de la salle. */
export async function createRoom(ed: Editor, progress: (done: number, total: number) => void): Promise<string> {
  const items = ed.usedIds().map((id) => ed.items[id]).filter((i): i is Item => !!i);
  const s = ed.structure();
  const board: LiveBoard = { ...s, items: items.map(toLive) };
  const { room } = await apiPost<{ room: string }>('/live', board);
  const imgs = items.filter((i): i is Item & { blob: Blob } => i.type === 'img' && !!i.blob);
  let done = 0;
  progress(0, imgs.length);
  const ok = await mapLimit(imgs, 4, async (it) => {
    const r = await upload(room, it.id, it.blob);
    progress(++done, imgs.length);
    return r;
  });
  const failed = ok.filter((x) => !x).length;
  if (failed) toast(`${failed} image${failed > 1 ? 's' : ''} non envoyée${failed > 1 ? 's' : ''}`);
  return room;
}

export class LiveLink {
  readonly room: string;
  status = $state<LiveStatus>('connecting');
  /** Personnes connectées, soi compris. */
  peers = $state(1);

  readonly #ed: Editor;
  #ws: WebSocket | null = null;
  #confirmed: Structure | null = null;
  #pending: Pending[] = [];
  #n = 0;
  #uploads: Promise<unknown> = Promise.resolve();
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  #fetching = new Set<string>();

  constructor(ed: Editor, room: string) {
    this.#ed = ed;
    this.room = room;
    this.#connect();
  }

  /** Envoie une opération déjà appliquée localement. */
  send(op: Op): void {
    const p: Pending = { n: ++this.#n, op, ready: false, sent: false };
    this.#pending.push(p);
    const blobs = opItems(op)
      .map((i) => this.#ed.items[i.id])
      .filter((i): i is Item & { blob: Blob } => i?.type === 'img' && !!i.blob);
    // #flush s'arrête à la première opération pas prête : l'ordre d'envoi reste celui des modifications.
    if (!blobs.length) {
      p.ready = true;
      this.#flush();
      return;
    }
    this.#uploads = this.#uploads.then(async () => {
      const ok = await mapLimit(blobs, 4, (it) => upload(this.room, it.id, it.blob));
      if (ok.includes(false)) toast('Une image n’a pas pu être envoyée aux autres');
      p.ready = true;
      this.#flush();
    });
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#ws?.close();
    this.#ws = null;
  }

  /** Recalcule l'état affiché (confirmé + en attente), ex. après un glisser annulé. */
  refresh(incoming: LiveItem[] = []): void {
    if (!this.#confirmed) return;
    const s = structuredClone(this.#confirmed);
    for (const p of this.#pending) applyOp(s, p.op);
    this.#ed.adopt(s, incoming);
    this.#fetchImages();
  }

  /* ---------- connexion ---------- */

  #connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/live/${this.room}/ws`);
    this.#ws = ws;
    ws.onmessage = (e) => {
      if (this.#ws === ws && typeof e.data === 'string') this.#onMessage(e.data);
    };
    ws.onclose = () => {
      if (this.#ws !== ws || this.#closed) return;
      this.#ws = null;
      this.status = 'offline';
      void this.#reconnect();
    };
  }

  async #reconnect() {
    // Un échec peut venir d'une salle disparue : on vérifie avant de réessayer indéfiniment.
    try {
      await apiGet(`/live/${this.room}/info`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        this.status = 'gone';
        return;
      }
    }
    if (this.#closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.#retry++);
    this.#timer = setTimeout(() => this.#connect(), delay);
  }

  #onMessage(raw: string) {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'state': {
        const { items, ...structure } = msg.board;
        this.#confirmed = structure;
        this.status = 'online';
        this.#retry = 0;
        for (const p of this.#pending) p.sent = false;
        this.refresh(items);
        this.#flush();
        return;
      }
      case 'op':
        if (!this.#confirmed) return;
        applyOp(this.#confirmed, msg.op);
        this.refresh(opItems(msg.op));
        return;
      case 'ack': {
        const i = this.#pending.findIndex((p) => p.n === msg.n);
        if (i < 0 || !this.#confirmed) return;
        const [p] = this.#pending.splice(i, 1);
        // Notre opération rejoint l'état confirmé : l'état affiché ne change pas.
        applyOp(this.#confirmed, p.op);
        return;
      }
      case 'peers':
        this.peers = msg.n;
        return;
    }
  }

  /** Envoie, dans l'ordre, les opérations prêtes et pas encore parties. */
  #flush() {
    const ws = this.#ws;
    if (!ws || this.status !== 'online') return;
    for (const p of this.#pending) {
      if (!p.ready) break;
      if (p.sent) continue;
      ws.send(JSON.stringify({ t: 'op', n: p.n, op: p.op } satisfies ClientMsg));
      p.sent = true;
    }
  }

  /** Télécharge les images des vignettes reçues d'autres personnes (jusqu'à 3 essais par image). */
  #fetchImages() {
    const missing = this.#ed
      .usedIds()
      .filter((id) => this.#ed.items[id]?.type === 'img' && !this.#ed.items[id].blob && !this.#fetching.has(id));
    if (!missing.length) return;
    for (const id of missing) this.#fetching.add(id);
    void mapLimit(missing, 4, async (id) => {
      for (let i = 0; i < 3 && !this.#closed; i++) {
        const blob = await fetch(`/api${imgPath(this.room, id)}`)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null);
        if (blob) {
          this.#ed.setBlob(id, blob);
          break;
        }
        await wait(2000 * (i + 1));
      }
      this.#fetching.delete(id);
    });
  }
}
