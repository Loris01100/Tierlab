import { TIER_COLORS, TILE_COLORS } from './constants';
import type { Item, Tier, TierList } from './types';
import { fgFor, uid } from './utils';

/** Crée des rangs avec un dégradé de couleurs du rouge au bleu. */
export function mkTiers(names: string[]): Tier[] {
  return names.map((name, i) => ({
    id: uid(),
    name,
    color: TIER_COLORS[Math.round((i * (TIER_COLORS.length - 1)) / Math.max(1, names.length - 1))],
    items: [],
  }));
}

export function newList(title: string, tierNames: string[]): TierList {
  const now = Date.now();
  return { id: uid(), title, tiers: mkTiers(tierNames), pool: [], createdAt: now, updatedAt: now };
}

export function textItem(listId: string, text: string, bg: string): Item {
  return { id: uid(), listId, type: 'text', text, bg, fg: fgFor(bg) };
}

/** Liste d'exemple créée au premier lancement. */
export function sampleList(): { list: TierList; items: Item[] } {
  const list = newList('Meilleurs fruits', ['S', 'A', 'B', 'C', 'D', 'F']);
  const items: Item[] = [];
  const put = (target: string[], texts: string[]) =>
    texts.forEach((t, i) => {
      const it = textItem(list.id, t, TILE_COLORS[(t.length + i) % 7]);
      items.push(it);
      target.push(it.id);
    });
  put(list.tiers[0].items, ['Mangue', 'Fraise']);
  put(list.tiers[1].items, ['Cerise', 'Pêche', 'Ananas']);
  put(list.tiers[2].items, ['Pomme', 'Banane']);
  put(list.tiers[3].items, ['Kiwi', 'Poire']);
  put(list.tiers[4].items, ['Pamplemousse']);
  put(list.pool, ['Raisin', 'Litchi', 'Melon', 'Figue', 'Abricot']);
  return { list, items };
}

export const countTiles = (l: Pick<TierList, 'tiers' | 'pool'>): number =>
  l.pool.length + l.tiers.reduce((n, t) => n + t.items.length, 0);
