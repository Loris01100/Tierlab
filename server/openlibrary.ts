import type { CatalogHit } from '../shared/catalog';
import type { CatalogSource } from './catalog';
import { getJson } from './http';

/**
 * Livres via Open Library (Internet Archive) : API publique, gratuite, sans clé.
 * Documentation : https://openlibrary.org/dev/docs/api/search
 * Les couvertures redirigent vers archive.org : ce domaine est donc aussi autorisé dans le relais d'images.
 */

const HOST = 'openlibrary.org';
const LIMIT = 20;

interface OlDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
}

export const booksSource: CatalogSource = {
  images: [{ host: 'covers.openlibrary.org' }, { host: 'archive.org', sub: true }],

  async search(q) {
    const url = new URL(`https://${HOST}/search.json`);
    url.searchParams.set('q', q);
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i');
    url.searchParams.set('limit', String(LIMIT));
    url.searchParams.set('lang', 'fr'); // privilégie les éditions françaises, sans exclure les autres
    const d = await getJson<{ docs?: OlDoc[] }>(url, { service: 'Open Library', host: HOST });
    return (d.docs ?? []).map(
      (b): CatalogHit => ({
        id: b.key.replace('/works/', ''),
        name: b.title,
        image: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
        detail: [b.author_name?.[0], b.first_publish_year].filter(Boolean).join(' · ') || undefined,
      }),
    );
  },
};
