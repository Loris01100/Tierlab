import type { AlbumGroup, AlbumInfo, ArtistHit, TrackInfo } from '../shared/music';
import { HttpError, type Route } from './api';
import { CACHE_LONG, CACHE_SHORT, sleep } from './http';
import type { ImageHost } from './media';

/**
 * Catalogue musical via l'API publique Deezer : gratuite, sans compte ni clé.
 * Documentation : https://developers.deezer.com/api
 * Quota : 50 requêtes par tranche de 5 secondes et par IP (on patiente et on réessaie si dépassé).
 */

const API = 'https://api.deezer.com';
const ID_RE = /^\d{1,15}$/;
/** Taille de page maximale acceptée par Deezer. */
const PAGE = 100;
/** Pochettes et photos d'artistes, relayées par /api/image (server/media.ts). */
export const deezerImages: readonly ImageHost[] = [{ host: 'dzcdn.net', sub: true }];

/* ---------- types bruts Deezer (champs utilisés seulement) ---------- */

interface DzPage<T> {
  data: T[];
  total?: number;
  next?: string;
}
interface DzError {
  error: { type: string; message: string; code: number };
}
interface DzArtist {
  id: number;
  name: string;
  picture_medium?: string;
  nb_album?: number;
}
interface DzAlbum {
  id: number;
  title: string;
  record_type: string;
  release_date?: string;
  cover_medium?: string;
  cover_big?: string;
}
interface DzTrack {
  id: number;
  title: string;
  disk_number?: number;
  track_position?: number;
}

/** GET sur l'API Deezer. Deezer renvoie ses erreurs avec un statut 200 et un objet { error }. */
async function dz<T>(pathOrUrl: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(pathOrUrl, API);
  url.protocol = 'https:';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (url.host !== 'api.deezer.com') throw new HttpError(500, 'URL Deezer inattendue');
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(url);
    } catch {
      throw new HttpError(502, 'Deezer injoignable');
    }
    if (r.status >= 500 && attempt < 2) {
      await sleep(1000);
      continue;
    }
    if (!r.ok) throw new HttpError(502, `Deezer a répondu ${r.status}`);
    const d = (await r.json().catch(() => {
      throw new HttpError(502, 'Réponse Deezer illisible');
    })) as T | DzError;
    if (d && typeof d === 'object' && 'error' in d) {
      const { code, message } = d.error;
      if (code === 4 && attempt < 3) {
        // quota dépassé : la fenêtre est de 5 s
        await sleep(2000);
        continue;
      }
      if (code === 800) throw new HttpError(404, 'Introuvable sur Deezer');
      if (code === 4) throw new HttpError(429, 'Deezer limite les requêtes, réessayez dans un instant.');
      throw new HttpError(502, `Erreur Deezer : ${message}`);
    }
    return d as T;
  }
}

/**
 * Lit toutes les pages d'une liste, jusqu'à `max` éléments.
 * La première page donne `total` : les suivantes sont alors demandées en parallèle (au plus max / PAGE requêtes,
 * bien sous le quota) au lieu d'être enchaînées. Sans `total`, on suit les liens `next` un par un.
 */
async function all<T>(path: string, max: number): Promise<T[]> {
  const first = await dz<DzPage<T>>(path, { limit: PAGE, index: 0 });
  const out = [...first.data];
  if (typeof first.total === 'number') {
    const end = Math.min(first.total, max);
    const rest: Promise<DzPage<T>>[] = [];
    for (let index = PAGE; index < end; index += PAGE) rest.push(dz<DzPage<T>>(path, { limit: PAGE, index }));
    for (const p of await Promise.all(rest)) out.push(...p.data);
  } else {
    let next = first.next;
    while (next && out.length < max) {
      const p: DzPage<T> = await dz<DzPage<T>>(next);
      out.push(...p.data);
      next = p.next;
    }
  }
  return out.slice(0, max);
}

function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

/** record_type Deezer : album, single, ep, compile. */
const GROUP_OF: Record<string, AlbumGroup> = { album: 'album', single: 'single', ep: 'single', compile: 'compilation' };
const GROUPS = new Set<string>(['album', 'single', 'compilation'] satisfies AlbumGroup[]);

/* ---------- routes ---------- */

export const musicRoutes: Route[] = [
  {
    method: 'GET',
    path: '/music/artists',
    cache: CACHE_SHORT,
    async handler({ query }) {
      const q = (query.get('q') ?? '').trim().slice(0, 100);
      if (!q) return { artists: [] };
      const d = await dz<DzPage<DzArtist>>('/search/artist', { limit: 10, q });
      const artists: ArtistHit[] = d.data.map((a) => ({
        id: String(a.id),
        name: a.name,
        image: a.picture_medium || null,
        albums: a.nb_album ?? 0,
      }));
      return { artists };
    },
  },
  {
    method: 'GET',
    path: '/music/artists/:id/albums',
    cache: CACHE_SHORT,
    async handler({ params, query }) {
      const id = checkId(params.id);
      const groups = new Set((query.get('groups') ?? 'album,single,compilation').split(',').filter((g) => GROUPS.has(g)));
      if (!groups.size) return { albums: [] };
      const raw = await all<DzAlbum>(`/artist/${id}/albums`, 1000);
      // Plusieurs éditions d'une même sortie sont fréquentes : on garde la plus récente.
      raw.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''));
      const seen = new Set<string>();
      const albums: AlbumInfo[] = [];
      for (const a of raw) {
        const type = GROUP_OF[a.record_type] ?? 'album';
        if (!groups.has(type)) continue;
        const key = `${type}|${a.title.toLocaleLowerCase().trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        albums.push({
          id: String(a.id),
          name: a.title,
          type,
          year: a.release_date?.slice(0, 4) ?? '',
          image: a.cover_big || a.cover_medium || null,
        });
      }
      return { albums };
    },
  },
  {
    method: 'GET',
    path: '/music/albums/:id/tracks',
    cache: CACHE_LONG,
    async handler({ params }) {
      const id = checkId(params.id);
      const raw = await all<DzTrack>(`/album/${id}/tracks`, 300);
      const tracks: TrackInfo[] = raw.map((t) => ({
        id: String(t.id),
        name: t.title,
        disc: t.disk_number ?? 1,
        number: t.track_position ?? 0,
      }));
      return { tracks };
    },
  },
];
