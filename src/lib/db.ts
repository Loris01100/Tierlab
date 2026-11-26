import Dexie, { type EntityTable } from 'dexie';
import type { Item, TierList } from './types';

/**
 * Base IndexedDB.
 * - lists : la structure de chaque tier liste (léger, chargé pour la bibliothèque)
 * - items : les vignettes, indexées par listId (images en Blob, chargées à l'ouverture d'une liste)
 * - lists.live : id de la salle d'édition partagée pour une liste synchronisée (index v2)
 * Pour faire évoluer le schéma : ajouter this.version(2).stores({...}).upgrade(...) sans modifier la v1.
 */
class TierlabDB extends Dexie {
  lists!: EntityTable<TierList, 'id'>;
  items!: EntityTable<Item, 'id'>;

  constructor() {
    super('tierlab');
    this.version(1).stores({
      lists: 'id, updatedAt',
      items: 'id, listId',
    });
    // v2 : index sur la salle d'édition partagée (champ optionnel, aucune donnée à migrer).
    this.version(2).stores({
      lists: 'id, updatedAt, live',
      items: 'id, listId',
    });
  }
}

export const db = new TierlabDB();

/** Toutes les listes, la plus récente d'abord (sans les vignettes). */
export const allLists = (): Promise<TierList[]> => db.lists.orderBy('updatedAt').reverse().toArray();

/** Copie locale reliée à une salle partagée, si elle existe déjà sur cet appareil. */
export const findLive = (room: string): Promise<TierList | undefined> => db.lists.where('live').equals(room).first();

export async function loadList(id: string): Promise<{ list: TierList; items: Item[] } | null> {
  const list = await db.lists.get(id);
  if (!list) return null;
  const items = await db.items.where('listId').equals(id).toArray();
  return { list, items };
}

/** Enregistre la structure et les vignettes nouvelles ou modifiées, en une seule transaction. */
export function saveList(list: TierList, items: Item[] = []): Promise<void> {
  return db.transaction('rw', db.lists, db.items, async () => {
    await db.lists.put(list);
    if (items.length) await db.items.bulkPut(items);
  });
}

export function deleteList(id: string): Promise<void> {
  return db.transaction('rw', db.lists, db.items, async () => {
    await db.lists.delete(id);
    await db.items.where('listId').equals(id).delete();
  });
}

/** Supprime les vignettes que la liste n'utilise plus (appelé à l'ouverture, l'historique étant vide). */
export function pruneItems(listId: string, keep: Set<string>): Promise<number> {
  return db.items
    .where('listId')
    .equals(listId)
    .filter((i) => !keep.has(i.id))
    .delete();
}

/** Premières vignettes de chaque rang, pour les aperçus de la bibliothèque (une seule lecture groupée). */
export async function previewItems(lists: TierList[], perTier: number, tiers: number): Promise<Map<string, Item>> {
  const ids = lists.flatMap((l) => l.tiers.slice(0, tiers).flatMap((t) => t.items.slice(0, perTier)));
  const found = await db.items.bulkGet(ids);
  return new Map(found.filter((i): i is Item => !!i).map((i) => [i.id, i]));
}
