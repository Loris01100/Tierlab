import type { AlbumGroup, AlbumInfo, ArtistHit, TrackInfo } from '../../shared/music';
import { apiGet, apiUrl } from './api';

/** Catalogue musical (Deezer, via le serveur /api/music). */
export type { AlbumGroup, AlbumInfo, ArtistHit, TrackInfo };

export const searchArtists = async (q: string, signal?: AbortSignal): Promise<ArtistHit[]> =>
  (await apiGet<{ artists: ArtistHit[] }>('/music/artists', { q }, signal)).artists;

export const artistAlbums = async (id: string, groups: AlbumGroup[], signal?: AbortSignal): Promise<AlbumInfo[]> =>
  (await apiGet<{ albums: AlbumInfo[] }>(`/music/artists/${encodeURIComponent(id)}/albums`, { groups: groups.join(',') }, signal)).albums;

export const albumTracks = async (id: string, signal?: AbortSignal): Promise<TrackInfo[]> =>
  (await apiGet<{ tracks: TrackInfo[] }>(`/music/albums/${encodeURIComponent(id)}/tracks`, {}, signal)).tracks;

/** URL d'une pochette relayée par le serveur. */
export const imageUrl = (url: string): string => apiUrl('/music/image', { url });

/** Télécharge une pochette en Blob. */
export async function fetchImage(url: string, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(imageUrl(url), { signal });
  if (!r.ok) throw new Error('image indisponible');
  return r.blob();
}
