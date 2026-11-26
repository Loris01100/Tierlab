/**
 * Catalogues : contrat commun à toutes les catégories (Pokémon, anime, livres…), partagé par le serveur et le navigateur.
 * Chaque catégorie renvoie la même forme de résultat ; la modale « Catalogues » ne sait pas d'où viennent les données.
 * Ajouter une catégorie : une entrée ici, puis une implémentation `CatalogSource` côté serveur (server/routes.ts).
 */

/** Un résultat, prêt à devenir une vignette (nom + image). */
export interface CatalogHit {
  id: string;
  name: string;
  /** URL d'origine de l'image, relayée par /api/image. */
  image: string | null;
  /** Ligne secondaire : année, auteur, type… */
  detail?: string;
}

export interface CatalogHits {
  hits: CatalogHit[];
}

/** Liste prédéfinie d'une catégorie (une génération, un top…), chargée d'un coup. */
export interface CatalogListDef {
  id: string;
  label: string;
}

export interface CatalogDef {
  label: string;
  /** Texte d'aide affiché dans la modale. */
  hint: string;
  placeholder: string;
  /** Source des données, citée dans l'interface. */
  credit: string;
  lists: readonly CatalogListDef[];
}

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => ({ id: `gen${g}`, label: `Génération ${g}` }));

export const CATALOGS = {
  pokemon: {
    label: 'Pokémon',
    hint: 'Recherchez un Pokémon par son nom (français ou anglais), ou chargez une génération entière.',
    placeholder: 'Ex. Pikachu',
    credit: 'Tyradex',
    lists: GENERATIONS,
  },
  anime: {
    label: 'Anime',
    hint: 'Recherchez une série ou un film d’animation, ou chargez un classement.',
    placeholder: 'Ex. One Piece',
    credit: 'AniList',
    lists: [
      { id: 'top', label: 'Top 100' },
      { id: 'season', label: 'Saison en cours' },
    ],
  },
  manga: {
    label: 'Manga',
    hint: 'Recherchez un manga, un manhwa ou un light novel, ou chargez le classement.',
    placeholder: 'Ex. Berserk',
    credit: 'AniList',
    lists: [{ id: 'top', label: 'Top 100' }],
  },
  characters: {
    label: 'Personnages',
    hint: 'Recherchez un personnage d’anime ou de manga, ou chargez les plus populaires.',
    placeholder: 'Ex. Luffy',
    credit: 'AniList',
    lists: [{ id: 'top', label: 'Top 100' }],
  },
  books: {
    label: 'Livres',
    hint: 'Recherchez un livre par titre ou par auteur.',
    placeholder: 'Ex. Dune',
    credit: 'Open Library',
    lists: [],
  },
  games: {
    label: 'Jeux vidéo',
    hint: 'Recherchez un jeu du Steam Store par son titre.',
    placeholder: 'Ex. Hollow Knight',
    credit: 'Steam',
    lists: [],
  },
} as const satisfies Record<string, CatalogDef>;

export type CatalogId = keyof typeof CATALOGS;

export const isCatalogId = (s: string): s is CatalogId => Object.hasOwn(CATALOGS, s);
