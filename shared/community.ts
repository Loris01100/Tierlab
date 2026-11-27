import type { LiveBoard } from './live';
import { LIMITS } from './rules';

/**
 * Listes publiées dans la communauté : types et bornes communs au navigateur et au serveur (server/gallery.ts).
 * Une publication est une copie figée d'une liste ; pas de comptes, l'auteur garde sur son appareil un jeton
 * qui permet de la mettre à jour ou de la retirer.
 */

export const COMMUNITY = {
  /** Listes par page de la galerie. */
  page: 24,
  /** Pages consultables au plus (galerie et recherche). */
  pages: 40,
  /** Taille maximale du corps d'une publication (caractères JSON, images en base64 comprises). */
  body: 8 * 1024 * 1024,
  /** Images au plus par liste publiée. */
  images: LIMITS.importImages,
  /** Taille maximale d'une image (octets). */
  image: 512 * 1024,
  author: 30,
  /** Signalements (de personnes différentes) au-delà desquels une liste est masquée. */
  hideAt: 3,
  /** Publications par heure et par adresse. */
  perHour: 10,
  /** Aperçu d'une carte : rangs et vignettes par rang. */
  previewTiers: 5,
  previewItems: 8,
  /** Image d'aperçu dessinée par le navigateur à la publication : dimensions (px) et taille maximale (octets). */
  thumbW: 480,
  thumbH: 284,
  thumb: 200 * 1024,
} as const;

export const PUB_RE = /^[a-z0-9]{16}$/;

export type CommunitySort = 'recent' | 'popular';

/** Vignette d'aperçu ; une image se lit sous /api/community/:id/img/:itemId. */
export interface PreviewItem {
  id: string;
  type: 'text' | 'img';
  bg?: string;
}

export interface PreviewTier {
  name: string;
  color: string;
  items: PreviewItem[];
}

/** Carte de la galerie. Dates en millisecondes. */
export interface CommunityCard {
  id: string;
  title: string;
  author: string;
  created: number;
  updated: number;
  tiles: number;
  tiers: number;
  copies: number;
  /**
   * Vrai si la liste a une image d'aperçu (/api/community/:id/thumb?v=<updated>) : une seule requête par carte.
   * Les listes publiées avant son ajout n'en ont pas et s'affichent avec preview.
   */
  thumb: boolean;
  preview: PreviewTier[];
}

export interface CommunityPage {
  lists: CommunityCard[];
  more: boolean;
}

/** Liste publiée complète (vue en lecture seule). */
export interface CommunityList extends CommunityCard {
  board: LiveBoard;
}

/** Réponse à une publication : le jeton n'est connu que de l'appareil qui publie. */
export interface Published {
  id: string;
  token: string;
}

/** Vignette au format d'échange (code « Partager », src/lib/share.ts) : image en data URL. */
export interface PubItem {
  type: 'text' | 'img';
  text: string;
  bg?: string;
  src?: string;
}

/** Corps d'une publication ou d'une mise à jour : le pseudo et la liste au format d'échange (SharedData v1). */
export interface PublishBody {
  token?: string;
  author: string;
  /** Aperçu de la carte de la galerie (WebP ou PNG en data URL, COMMUNITY.thumbW × thumbH). */
  thumb?: string;
  list: {
    v: 1;
    title: string;
    tiers: { name: string; color: string; items: string[] }[];
    pool: string[];
    items: Record<string, PubItem>;
  };
}
