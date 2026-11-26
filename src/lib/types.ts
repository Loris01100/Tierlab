import type { Op } from '../../shared/live';

/** Une vignette. Les images sont stockées en Blob (binaire) dans IndexedDB, pas en base64. */
export interface Item {
  id: string;
  listId: string;
  type: 'text' | 'img';
  text: string;
  /** Couleur de fond (vignettes texte). */
  bg?: string;
  /** Couleur du texte, calculée depuis bg. */
  fg?: string;
  /** Image réduite (WebP ou PNG). */
  blob?: Blob;
}

/** Brouillon de vignette (édition), sans identité. */
export type ItemDraft = Omit<Item, 'id' | 'listId'>;

export interface Tier {
  id: string;
  name: string;
  color: string;
  /** Ids des vignettes, dans l'ordre d'affichage. */
  items: string[];
}

/** Une tier liste. Les vignettes vivent dans une table séparée, chargées seulement à l'ouverture. */
export interface TierList {
  id: string;
  title: string;
  tiers: Tier[];
  pool: string[];
  createdAt: number;
  updatedAt: number;
  /** Salle d'édition partagée à laquelle cette liste est reliée (copie locale synchronisée), absent sinon. */
  live?: string;
  /** Opérations d'édition partagée pas encore confirmées par le serveur, renvoyées à la prochaine ouverture. */
  livePending?: Op[];
}
