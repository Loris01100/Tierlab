import { isColor, LIMITS } from './rules';

/**
 * Édition partagée en direct : types et règles communs au navigateur et au Durable Object.
 *
 * Chaque modification est une opération (Op) exprimant une intention (« mettre X dans tel rang à telle place »).
 * Le serveur les applique dans l'ordre d'arrivée puis les relaie ; chaque client applique les siennes tout de suite
 * et, à chaque opération reçue, recalcule son état à partir de l'état confirmé par le serveur + ses opérations en attente.
 * applyOp est donc partagé et doit rester déterministe et tolérant (id absent → opération sans effet).
 * Les opérations sont aussi idempotentes : un client qui renvoie ses opérations après une coupure ne crée pas de doublon.
 */

/** Zone de la réserve (vignettes non classées). */
export const POOL = 'pool';

export const LIVE = {
  /** Vignettes conservées au plus par salle. */
  items: 1000,
  /** Taille maximale d'une image envoyée (octets). */
  image: 512 * 1024,
  /** Taille maximale d'un message WebSocket ou du corps de création (caractères). */
  message: 512 * 1024,
  /** Longueur maximale d'un texte de vignette (même borne que l'import d'un code). */
  text: 200,
} as const;

export const ROOM_RE = /^[a-z0-9]{24,40}$/;
export const ID_RE = /^[\w-]{1,64}$/;
export const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif'] as const;

/** Vignette telle qu'échangée (l'image voyage à part, sous /api/live/:room/img/:id). */
export interface LiveItem {
  id: string;
  type: 'text' | 'img';
  text: string;
  bg?: string;
}

export interface LiveTier {
  id: string;
  name: string;
  color: string;
  items: string[];
}

/** Structure modifiée par les opérations (compatible avec la classe Editor côté navigateur). */
export interface Structure {
  title: string;
  tiers: LiveTier[];
  pool: string[];
}

/** État complet d'une salle envoyé à la connexion : la structure et les vignettes utilisées. */
export interface LiveBoard extends Structure {
  items: LiveItem[];
}

export type Op =
  /** at absent : en fin de zone. at est compté sans la vignette déplacée. */
  | { k: 'move'; id: string; zone: string; at?: number }
  | { k: 'remove'; id: string }
  | { k: 'add'; zone: string; items: LiveItem[] }
  /** Remplace une vignette par une nouvelle (les vignettes sont immuables). */
  | { k: 'replace'; id: string; item: LiveItem }
  /** Insère une copie juste après la vignette id. */
  | { k: 'dup'; id: string; item: LiveItem }
  | { k: 'tierAdd'; at: number; tier: { id: string; name: string; color: string } }
  | { k: 'tierMove'; id: string; to: number }
  | { k: 'tierSet'; id: string; name?: string; color?: string }
  | { k: 'tierClear'; id: string }
  | { k: 'tierDelete'; id: string }
  | { k: 'reset' }
  | { k: 'title'; title: string };

/** Vignettes nouvelles apportées par une opération. */
export function opItems(op: Op): LiveItem[] {
  if (op.k === 'add') return op.items;
  if (op.k === 'replace' || op.k === 'dup') return [op.item];
  return [];
}

/* ---------- messages WebSocket ---------- */

export type ClientMsg = { t: 'op'; n: number; op: Op };

export type ServerMsg =
  | { t: 'state'; board: LiveBoard }
  | { t: 'op'; op: Op }
  /** L'opération n du client a été appliquée (ou rejetée) par le serveur. */
  | { t: 'ack'; n: number }
  | { t: 'peers'; n: number };

/* ---------- application ---------- */

function lists(s: Structure): string[][] {
  return [s.pool, ...s.tiers.map((t) => t.items)];
}

function where(s: Structure, id: string): { list: string[] | null; index: number } {
  for (const list of lists(s)) {
    const index = list.indexOf(id);
    if (index > -1) return { list, index };
  }
  return { list: null, index: -1 };
}

const used = (s: Structure, id: string): boolean => where(s, id).list !== null;

function zoneList(s: Structure, zone: string): string[] {
  if (zone === POOL) return s.pool;
  return s.tiers.find((t) => t.id === zone)?.items ?? s.pool;
}

const clamp = (n: number, max: number): number => Math.max(0, Math.min(Math.trunc(n), max));

/** Applique une opération en place (fonctionne aussi sur les proxies $state de Svelte). */
export function applyOp(s: Structure, op: Op): void {
  switch (op.k) {
    case 'move': {
      const { list, index } = where(s, op.id);
      if (!list) return;
      list.splice(index, 1);
      const target = zoneList(s, op.zone);
      target.splice(op.at === undefined ? target.length : clamp(op.at, target.length), 0, op.id);
      return;
    }
    case 'remove': {
      const { list, index } = where(s, op.id);
      if (list) list.splice(index, 1);
      return;
    }
    case 'add': {
      const target = zoneList(s, op.zone);
      for (const it of op.items) if (!used(s, it.id)) target.push(it.id);
      return;
    }
    case 'replace': {
      const { list, index } = where(s, op.id);
      if (list && !used(s, op.item.id)) list[index] = op.item.id;
      return;
    }
    case 'dup': {
      const { list, index } = where(s, op.id);
      if (list && !used(s, op.item.id)) list.splice(index + 1, 0, op.item.id);
      return;
    }
    case 'tierAdd':
      if (s.tiers.length < LIMITS.tiers && !s.tiers.some((t) => t.id === op.tier.id))
        s.tiers.splice(clamp(op.at, s.tiers.length), 0, { ...op.tier, items: [] });
      return;
    case 'tierMove': {
      const i = s.tiers.findIndex((t) => t.id === op.id);
      if (i < 0) return;
      const [t] = s.tiers.splice(i, 1);
      s.tiers.splice(clamp(op.to, s.tiers.length), 0, t);
      return;
    }
    case 'tierSet': {
      const t = s.tiers.find((x) => x.id === op.id);
      if (!t) return;
      if (op.name !== undefined) t.name = op.name;
      if (op.color !== undefined) t.color = op.color;
      return;
    }
    case 'tierClear': {
      const t = s.tiers.find((x) => x.id === op.id);
      if (!t) return;
      s.pool.push(...t.items);
      t.items = [];
      return;
    }
    case 'tierDelete': {
      const i = s.tiers.findIndex((x) => x.id === op.id);
      if (i < 0) return;
      s.pool.push(...s.tiers[i].items);
      s.tiers.splice(i, 1);
      return;
    }
    case 'reset':
      for (const t of s.tiers) {
        s.pool.push(...t.items);
        t.items = [];
      }
      return;
    case 'title':
      s.title = op.title;
      return;
  }
}

/* ---------- validation des données reçues (non fiables) ---------- */

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);

export function cleanItem(v: unknown): LiveItem | null {
  if (!isObj(v)) return null;
  const i = id(v.id);
  if (!i || (v.type !== 'text' && v.type !== 'img')) return null;
  const it: LiveItem = { id: i, type: v.type, text: str(v.text, LIVE.text) };
  if (v.type === 'text') it.bg = isColor(v.bg) ? v.bg : '#3d5afe';
  return it;
}

const cleanName = (v: unknown): string => str(v, LIMITS.tierName);
const color = (v: unknown, fallback: string): string => (isColor(v) ? v : fallback);

/** Valide une opération reçue ; null si elle est mal formée. */
export function cleanOp(v: unknown): Op | null {
  if (!isObj(v)) return null;
  switch (v.k) {
    case 'move': {
      const i = id(v.id);
      const zone = id(v.zone);
      if (!i || !zone) return null;
      const at = int(v.at);
      return at === null ? { k: 'move', id: i, zone } : { k: 'move', id: i, zone, at };
    }
    case 'remove':
    case 'tierClear':
    case 'tierDelete': {
      const i = id(v.id);
      return i ? { k: v.k, id: i } : null;
    }
    case 'add': {
      const zone = id(v.zone);
      if (!zone || !Array.isArray(v.items)) return null;
      const items = v.items.slice(0, LIVE.items).map(cleanItem).filter((x): x is LiveItem => !!x);
      return { k: 'add', zone, items };
    }
    case 'replace':
    case 'dup': {
      const i = id(v.id);
      const item = cleanItem(v.item);
      return i && item ? { k: v.k, id: i, item } : null;
    }
    case 'tierAdd': {
      const at = int(v.at);
      const t = isObj(v.tier) ? v.tier : null;
      const i = id(t?.id);
      if (at === null || !t || !i) return null;
      return { k: 'tierAdd', at, tier: { id: i, name: cleanName(t.name), color: color(t.color, '#d0d0d0') } };
    }
    case 'tierMove': {
      const i = id(v.id);
      const to = int(v.to);
      return i && to !== null ? { k: 'tierMove', id: i, to } : null;
    }
    case 'tierSet': {
      const i = id(v.id);
      if (!i) return null;
      const op: Op = { k: 'tierSet', id: i };
      if (v.name !== undefined) op.name = cleanName(v.name);
      if (v.color !== undefined && isColor(v.color)) op.color = v.color;
      return op;
    }
    case 'reset':
      return { k: 'reset' };
    case 'title':
      return { k: 'title', title: str(v.title, LIMITS.title) };
    default:
      return null;
  }
}

/** Valide un état complet (création d'une salle) ; null si invalide. Les ids en double ou inconnus sont ignorés. */
export function cleanBoard(v: unknown): LiveBoard | null {
  if (!isObj(v) || !Array.isArray(v.tiers) || !Array.isArray(v.items)) return null;
  const items = v.items.slice(0, LIVE.items).map(cleanItem).filter((x): x is LiveItem => !!x);
  const known = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  const ids = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && known.has(x) && !seen.has(x) && !!seen.add(x)) : [];
  const tiers: LiveTier[] = [];
  for (const t of v.tiers.slice(0, LIMITS.tiers)) {
    const i = isObj(t) ? id(t.id) : null;
    if (!isObj(t) || !i || tiers.some((x) => x.id === i)) continue;
    tiers.push({ id: i, name: cleanName(t.name), color: color(t.color, '#d0d0d0'), items: ids(t.items) });
  }
  if (!tiers.length) return null;
  const pool = ids(v.pool);
  return { title: str(v.title, LIMITS.title), tiers, pool, items: items.filter((i) => seen.has(i.id)) };
}
