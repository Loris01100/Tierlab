import { CATALOGS, type CatalogHit, type CatalogHits, type CatalogId } from '../../shared/catalog';
import { apiGet } from './api';

/** Catalogues (Pokémon, anime, livres…) : une seule forme de résultat, quelle que soit la source (via /api/catalog). */
export { CATALOGS };
export type { CatalogHit, CatalogId };

/** `q` est normalisé (espaces, casse) pour que « Zelda » et « zelda  » partagent la même entrée de cache. */
export const searchCatalog = async (source: CatalogId, q: string, signal?: AbortSignal): Promise<CatalogHit[]> =>
  (await apiGet<CatalogHits>(
    `/catalog/${source}/search`,
    { q: q.trim().replace(/\s+/g, ' ').toLowerCase() },
    signal,
  )).hits;

export const catalogList = async (source: CatalogId, list: string, signal?: AbortSignal): Promise<CatalogHit[]> =>
  (await apiGet<CatalogHits>(`/catalog/${source}/lists/${encodeURIComponent(list)}`, {}, signal)).hits;

/** Onglet de la modale « Catalogues » : un catalogue générique ou la musique. */
export type CatalogTab = CatalogId | 'music';

/**
 * Onglet à ouvrir dès l’arrivée dans l’éditeur (raccourcis « Démarrer vite » de la bibliothèque).
 * Lu puis remis à null par l’éditeur ; non réactif, il ne sert qu’au passage d’une page à l’autre.
 */
export const pendingCatalog: { tab: CatalogTab | null } = { tab: null };
