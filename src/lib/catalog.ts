import { CATALOGS, type CatalogHit, type CatalogHits, type CatalogId } from '../../shared/catalog';
import { apiGet } from './api';

/** Catalogues (Pokémon, anime, livres…) : une seule forme de résultat, quelle que soit la source (via /api/catalog). */
export { CATALOGS };
export type { CatalogHit, CatalogId };

export const searchCatalog = async (source: CatalogId, q: string, signal?: AbortSignal): Promise<CatalogHit[]> =>
  (await apiGet<CatalogHits>(`/catalog/${source}/search`, { q }, signal)).hits;

export const catalogList = async (source: CatalogId, list: string, signal?: AbortSignal): Promise<CatalogHit[]> =>
  (await apiGet<CatalogHits>(`/catalog/${source}/lists/${encodeURIComponent(list)}`, {}, signal)).hits;
