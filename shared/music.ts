/** Types échangés entre le serveur (/api/music) et le navigateur. */

export interface ArtistHit {
  id: string;
  name: string;
  image: string | null;
  /** Nombre de sorties annoncé par la source (0 si inconnu). */
  albums: number;
}

export type AlbumGroup = 'album' | 'single' | 'compilation';

export interface AlbumInfo {
  id: string;
  name: string;
  type: AlbumGroup;
  year: string;
  image: string | null;
}

export interface TrackInfo {
  id: string;
  name: string;
  disc: number;
  number: number;
}
