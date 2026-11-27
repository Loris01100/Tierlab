import { HttpError, type Ctx } from './api';
import { COMMUNITY } from '../shared/community';
import { cleanBoard, cleanItem, ID_RE, LIVE, type LiveBoard, type LiveItem } from '../shared/live';

/*
 * Validation des publications de la galerie, faite dans le Worker (server/community.ts) : il n'a pas d'état et
 * tourne en parallèle, alors que le Durable Object Gallery est unique pour tout le monde. Lecture du corps (jusqu'à
 * COMMUNITY.body), décodage base64 et vérification des signatures ne bloquent donc plus la galerie.
 * Le Worker transmet à l'objet un corps déjà propre au format binaire packPublish ; l'objet ne fait plus que
 * unpackPublish (découpage d'octets), la limite par adresse et les insertions.
 */

export interface Image {
  type: string;
  data: Uint8Array;
}

export interface Cleaned {
  /** Jeton de l'auteur (mise à jour), non vérifié ici : seul l'objet connaît son empreinte. */
  token?: string;
  author: string;
  board: LiveBoard;
  images: Map<string, Image>;
  thumb: Image | null;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** Longueur maximale acceptée pour un jeton (auteur ou ADMIN_TOKEN). */
const TOKEN_MAX = 256;

/** Lit un corps JSON objet d'au plus max caractères. */
export async function readBody(ctx: Ctx, max: number = COMMUNITY.body): Promise<Raw> {
  if (Number(ctx.request.headers.get('Content-Length') ?? 0) > max) throw new HttpError(413, 'Liste trop lourde pour être publiée');
  const text = await ctx.request.text();
  if (text.length > max) throw new HttpError(413, 'Liste trop lourde pour être publiée');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
  if (!isObj(v)) throw new HttpError(400, 'Liste invalide');
  return v;
}

/** Jeton d'un corps, ou undefined s'il est absent ou malformé (l'objet répondra alors 403). */
export function readToken(raw: Raw): string | undefined {
  return typeof raw.token === 'string' && raw.token && raw.token.length <= TOKEN_MAX ? raw.token : undefined;
}

const IMG_SRC = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

function decodeImage(src: unknown, max: number = COMMUNITY.image): Image | null {
  const m = typeof src === 'string' ? IMG_SRC.exec(src) : null;
  if (!m || (m[2].length * 3) / 4 > max) return null;
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

/** Valide un corps de publication (données non fiables) : liste au format d'échange + pseudo. */
export function cleanPublish(raw: Raw): Cleaned {
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
  // Aperçu absent ou refusé : la carte retombe sur l'aperçu par vignettes (preview).
  const thumb = decodeImage(raw.thumb, COMMUNITY.thumb);
  return { token: readToken(raw), author, board, images, thumb };
}

/* ---------- format interne Worker → Durable Object ---------- */

/** Type MIME du corps interne : l'objet refuse tout autre format pour publish / update. */
export const PACKED = 'application/x-tierlab-publish';

/** En-tête JSON du format interne ; les octets des images suivent dans l'ordre de images puis thumb. */
interface PackedHead {
  token?: string;
  author: string;
  board: LiveBoard;
  images: [id: string, type: string, size: number][];
  thumb: [type: string, size: number] | null;
}

/** Corps interne : longueur de l'en-tête (4 octets, gros-boutiste), en-tête JSON UTF-8, puis les images brutes. */
export function packPublish(c: Cleaned): Uint8Array {
  const parts = [...c.images.values()].map((i) => i.data);
  if (c.thumb) parts.push(c.thumb.data);
  const head: PackedHead = {
    token: c.token,
    author: c.author,
    board: c.board,
    images: [...c.images].map(([id, i]) => [id, i.type, i.data.length]),
    thumb: c.thumb ? [c.thumb.type, c.thumb.data.length] : null,
  };
  const headBytes = new TextEncoder().encode(JSON.stringify(head));
  const out = new Uint8Array(4 + headBytes.length + parts.reduce((n, p) => n + p.length, 0));
  new DataView(out.buffer).setUint32(0, headBytes.length);
  out.set(headBytes, 4);
  let at = 4 + headBytes.length;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Relit un corps produit par packPublish (source de confiance : le Worker). */
export function unpackPublish(buf: ArrayBuffer): Cleaned {
  const headLen = new DataView(buf).getUint32(0);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen))) as PackedHead;
  let at = 4 + headLen;
  const take = (type: string, size: number): Image => {
    const data = new Uint8Array(buf.slice(at, at + size));
    at += size;
    return { type, data };
  };
  const images = new Map(head.images.map(([id, type, size]) => [id, take(type, size)]));
  const thumb = head.thumb ? take(...head.thumb) : null;
  return { token: head.token, author: head.author, board: head.board, images, thumb };
}
