import type { CatalogHit } from '../shared/catalog';
import { HttpError } from './api';
import type { CatalogSource } from './catalog';
import { getJson } from './http';
import type { ImageHost } from './media';

/**
 * Anime, manga et personnages via AniList : API GraphQL officielle, publique, sans clé pour la lecture.
 * Documentation : https://docs.anilist.co
 * Quota : 30 requêtes par minute et par IP (en-tête X-RateLimit-Limit). Un top 100 coûte 2 requêtes (50 par page).
 */

const HOST = 'graphql.anilist.co';
const ENDPOINT = new URL(`https://${HOST}/`);
/** Taille de page maximale acceptée par AniList. */
const PAGE = 50;
const SEARCH_LIMIT = 20;
const LIST_PAGES = 2;
const IMAGES: readonly ImageHost[] = [{ host: 's4.anilist.co', path: '/file/anilistcdn/' }];

interface AlMedia {
  id: number;
  title: { romaji: string | null; english: string | null };
  format: string | null;
  startDate: { year: number | null } | null;
  coverImage: { large: string | null } | null;
}
interface AlCharacter {
  id: number;
  name: { full: string | null; native: string | null };
  image: { large: string | null } | null;
}
interface AlPage<T> {
  data?: { Page: { pageInfo: { hasNextPage: boolean }; media?: T[]; characters?: T[] } | null };
  errors?: { message: string }[];
}

/* Requêtes GraphQL : AniList refuse une variable déclarée mais non utilisée, d'où deux requêtes distinctes. */
const MEDIA_QUERY = `query ($page: Int, $perPage: Int, $type: MediaType, $search: String, $sort: [MediaSort], $season: MediaSeason, $year: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: $type, search: $search, sort: $sort, season: $season, seasonYear: $year, isAdult: false) {
      id title { romaji english } format startDate { year } coverImage { large }
    }
  }
}`;
const CHAR_QUERY = `query ($page: Int, $perPage: Int, $search: String, $sort: [CharacterSort]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    characters(search: $search, sort: $sort) { id name { full native } image { large } }
  }
}`;

type Vars = Record<string, string | number | string[]>;

async function page<T>(q: string, vars: Vars): Promise<{ items: T[]; next: boolean }> {
  const d = await getJson<AlPage<T>>(ENDPOINT, { service: 'AniList', host: HOST, body: { query: q, variables: vars } });
  const p = d.data?.Page;
  if (!p) throw new HttpError(502, `Erreur AniList : ${d.errors?.[0]?.message ?? 'réponse vide'}`);
  return { items: p.media ?? p.characters ?? [], next: p.pageInfo.hasNextPage };
}

/** Lit jusqu'à LIST_PAGES pages à la suite (une liste de 100 reste bien sous le quota). */
async function pages<T>(q: string, vars: Vars): Promise<T[]> {
  const out: T[] = [];
  for (let n = 1; n <= LIST_PAGES; n++) {
    const p = await page<T>(q, { ...vars, page: n, perPage: PAGE });
    out.push(...p.items);
    if (!p.next) break;
  }
  return out;
}

const FORMAT: Record<string, string> = {
  TV: 'Série',
  TV_SHORT: 'Série courte',
  MOVIE: 'Film',
  SPECIAL: 'Spécial',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Clip',
  MANGA: 'Manga',
  NOVEL: 'Light novel',
  ONE_SHOT: 'One shot',
};

function media(m: AlMedia): CatalogHit {
  const name = m.title.romaji || m.title.english || '?';
  const english = m.title.english && m.title.english !== name ? m.title.english : '';
  const format = m.format ? (FORMAT[m.format] ?? m.format) : '';
  return {
    id: String(m.id),
    name,
    image: m.coverImage?.large ?? null,
    detail: [format, m.startDate?.year, english].filter(Boolean).join(' · ') || undefined,
  };
}

const character = (c: AlCharacter): CatalogHit => ({
  id: String(c.id),
  name: c.name.full || c.name.native || '?',
  image: c.image?.large ?? null,
  detail: c.name.native || undefined,
});

/** Saison AniList en cours : décembre appartient à l'hiver de l'année suivante. */
function currentSeason(now = new Date()): { season: string; year: number } {
  const m = now.getUTCMonth();
  const year = now.getUTCFullYear();
  if (m === 11) return { season: 'WINTER', year: year + 1 };
  return { season: ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL'][m], year };
}

const searchMedia = async (type: 'ANIME' | 'MANGA', search: string) =>
  (await page<AlMedia>(MEDIA_QUERY, { type, search, sort: ['SEARCH_MATCH'], perPage: SEARCH_LIMIT })).items.map(media);

export const animeSource: CatalogSource = {
  images: IMAGES,
  search: (q) => searchMedia('ANIME', q),
  async list(id) {
    const vars: Vars = id === 'season' ? { type: 'ANIME', sort: ['POPULARITY_DESC'], ...currentSeason() } : { type: 'ANIME', sort: ['SCORE_DESC'] };
    return (await pages<AlMedia>(MEDIA_QUERY, vars)).map(media);
  },
};

export const mangaSource: CatalogSource = {
  images: IMAGES,
  search: (q) => searchMedia('MANGA', q),
  list: async () => (await pages<AlMedia>(MEDIA_QUERY, { type: 'MANGA', sort: ['SCORE_DESC'] })).map(media),
};

export const charactersSource: CatalogSource = {
  images: IMAGES,
  search: async (q) => (await page<AlCharacter>(CHAR_QUERY, { search: q, sort: ['SEARCH_MATCH'], perPage: SEARCH_LIMIT })).items.map(character),
  list: async () => (await pages<AlCharacter>(CHAR_QUERY, { sort: ['FAVOURITES_DESC'] })).map(character),
};
