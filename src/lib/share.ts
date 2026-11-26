import { LIMITS } from './constants';
import { saveList } from './db';
import { blobToDataURL, dataURLToBlob, shrink } from './images';
import type { Item, Tier } from './types';
import { fgFor, isColor, uid } from './utils';

/**
 * Format d'échange JSON (code « Partager »). Compatible avec le prototype MainList_v1.html :
 * les images y sont en data URL base64, converties en Blob à l'import.
 */
export interface SharedItem {
  type: 'text' | 'img';
  text: string;
  bg?: string;
  src?: string;
}
export interface SharedData {
  v: 1;
  title: string;
  tiers: { name: string; color: string; items: string[] }[];
  pool: string[];
  items: Record<string, SharedItem>;
}

interface Source {
  title: string;
  tiers: Tier[];
  pool: string[];
  items: Record<string, Item>;
}

export async function toShared(s: Source): Promise<SharedData> {
  const items: Record<string, SharedItem> = {};
  for (const id of [...s.pool, ...s.tiers.flatMap((t) => t.items)]) {
    const it = s.items[id];
    if (!it) continue;
    items[id] =
      it.type === 'img'
        ? { type: 'img', text: it.text, src: it.blob ? await blobToDataURL(it.blob) : '' }
        : { type: 'text', text: it.text, bg: it.bg };
  }
  return {
    v: 1,
    title: s.title,
    tiers: s.tiers.map((t) => ({ name: t.name, color: t.color, items: [...t.items] })),
    pool: [...s.pool],
    items,
  };
}

export interface Imported {
  title: string;
  tiers: Tier[];
  pool: string[];
  items: Item[];
}

const IMG_SRC = /^data:image\/(png|jpeg|webp|gif);base64,/;

/** Valide un code reçu et le convertit pour la liste listId (nouveaux ids partout). null si invalide. */
export async function fromShared(raw: unknown, listId: string): Promise<Imported | null> {
  const d = raw as Partial<SharedData> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.tiers) || !d.items || typeof d.items !== 'object') return null;

  const map = new Map<string, string>();
  const items: Item[] = [];
  let images = 0;
  for (const [k, v] of Object.entries(d.items)) {
    if (!v || typeof v !== 'object') continue;
    const text = String(v.text ?? '').slice(0, LIMITS.tileText);
    const id = uid();
    if (v.type === 'img') {
      if (typeof v.src !== 'string' || !IMG_SRC.test(v.src) || images >= LIMITS.importImages) continue;
      try {
        // Un code peut venir d'ailleurs (prototype, autre appareil) : images réduites comme un import de fichier.
        items.push({ id, listId, type: 'img', text, blob: await shrink(await dataURLToBlob(v.src)) });
        images++;
      } catch {
        continue;
      }
    } else {
      const bg = isColor(v.bg) ? v.bg : '#3d5afe';
      items.push({ id, listId, type: 'text', text, bg, fg: fgFor(bg) });
    }
    map.set(k, id);
  }

  const seen = new Set<string>();
  const ids = (a: unknown): string[] =>
    Array.isArray(a)
      ? a
          .map((k) => map.get(String(k)))
          .filter((id): id is string => !!id && !seen.has(id) && !!seen.add(id))
      : [];

  const tiers: Tier[] = d.tiers.slice(0, LIMITS.tiers).map((t) => ({
    id: uid(),
    name: String(t?.name ?? '?').slice(0, LIMITS.tierName) || '?',
    color: isColor(t?.color) ? t.color : '#d0d0d0',
    items: ids(t?.items),
  }));
  if (!tiers.length) return null;
  return { title: String(d.title ?? '').slice(0, LIMITS.title), tiers, pool: ids(d.pool), items };
}

/** Enregistre un code reçu comme nouvelle liste locale ; renvoie son id, ou null si le code est invalide. */
export async function saveShared(raw: unknown, title?: string): Promise<string | null> {
  const id = uid();
  const d = await fromShared(raw, id);
  if (!d) return null;
  const now = Date.now();
  await saveList({ id, title: title ?? (d.title || 'Tier liste importée'), tiers: d.tiers, pool: d.pool, createdAt: now, updatedAt: now }, d.items);
  return id;
}
