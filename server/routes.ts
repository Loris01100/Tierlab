import { animeSource, charactersSource, mangaSource } from './anilist';
import { createApi } from './api';
import { catalogRoutes, type CatalogSources } from './catalog';
import { communityRoutes } from './community';
import { deezerImages, musicRoutes } from './deezer';
import { liveRoutes } from './live';
import { imageRoutes } from './media';
import { booksSource } from './openlibrary';
import { pokemonSource } from './tyradex';

/** Une implémentation par catégorie de shared/catalog.ts (le type impose qu'aucune ne manque). */
const catalogs: CatalogSources = {
  pokemon: pokemonSource,
  anime: animeSource,
  manga: mangaSource,
  characters: charactersSource,
  books: booksSource,
};

const imageHosts = [...deezerImages, ...Object.values(catalogs).flatMap((s) => s.images)];

/** Toutes les routes /api de l'application, partagées par le Worker et par Vite. */
export const handleApi = createApi([...musicRoutes, ...catalogRoutes(catalogs), ...imageRoutes(imageHosts), ...liveRoutes, ...communityRoutes]);
