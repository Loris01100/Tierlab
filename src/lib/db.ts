import Dexie, { type EntityTable } from 'dexie';
import type { Item, TierList } from './types';

/**
 * Base IndexedDB.
 * - lists : la structure de chaque tier liste (léger, chargé pour la bibliothèque)
 * - items : les vignettes, indexées par listId (images en Blob, chargées à l'ouverture d'une liste)
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
  }
}

export const db = new TierlabDB();

/** Toutes les listes, la plus récente d'abord (sans les vignettes). */
export const allLists = (): Promise<TierList[]> => db.lists.orderBy('updatedAt').reverse().toArray();

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
