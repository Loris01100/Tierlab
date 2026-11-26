import { CATALOGS, isCatalogId, type CatalogHit, type CatalogHits, type CatalogId } from '../shared/catalog';
import { HttpError, type Route } from './api';
import { CACHE_SHORT } from './http';
import type { ImageHost } from './media';

/**
 * Routes génériques des catalogues : chaque catégorie fournit une implémentation de `CatalogSource`,
 * les routes, la validation et le cache sont communs.
 */

export interface CatalogSource {
  /** `q` est déjà nettoyé (non vide, 100 caractères au plus). */
  search(q: string): Promise<CatalogHit[]>;
  /** Charge une liste déclarée dans `CATALOGS[id].lists` (l'id est déjà validé). */
  list?(id: string): Promise<CatalogHit[]>;
  /** Domaines des images renvoyées, ajoutés à la liste blanche de /api/image. */
  images: readonly ImageHost[];
}

export type CatalogSources = Record<CatalogId, CatalogSource>;

function sourceOf(sources: CatalogSources, id: string): CatalogSource {
  if (!isCatalogId(id)) throw new HttpError(404, 'Catalogue inconnu');
  return sources[id];
}

export function catalogRoutes(sources: CatalogSources): Route[] {
  return [
    {
      method: 'GET',
      path: '/catalog/:source/search',
      cache: CACHE_SHORT,
      async handler({ params, query }): Promise<CatalogHits> {
        const src = sourceOf(sources, params.source);
        const q = (query.get('q') ?? '').trim().slice(0, 100);
        return { hits: q ? await src.search(q) : [] };
      },
    },
    {
      method: 'GET',
      path: '/catalog/:source/lists/:list',
      cache: CACHE_SHORT,
      async handler({ params }): Promise<CatalogHits> {
        const src = sourceOf(sources, params.source);
        const defs: readonly { id: string }[] = CATALOGS[params.source as CatalogId].lists;
        if (!src.list || !defs.some((l) => l.id === params.list)) throw new HttpError(404, 'Liste inconnue');
        return { hits: await src.list(params.list) };
      },
    },
  ];
}
