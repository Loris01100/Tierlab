import type { CatalogHit } from '../shared/catalog';
import type { CatalogSource } from './catalog';
import { getJson } from './http';

/**
 * Jeux via la recherche du Steam Store : API non officielle mais stable, gratuite, sans clé.
 * Point d'entrée : https://store.steampowered.com/api/storesearch/?term=…&l=french&cc=FR (10 résultats au plus).
 * Les images sont sur le CDN steamstatic. La jaquette verticale (library_600x900) manque pour certains
 * contenus (bandes-son, vieux jeux) : on vérifie sa présence et on se rabat sur la bannière header.jpg.
 */

const HOST = 'store.steampowered.com';
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const COVER_TIMEOUT = 1500;
/** Nombre d'images retenues en mémoire : au-delà, les plus anciennes sont oubliées. */
const COVER_MAX = 2000;

/**
 * Image retenue par jeu, pour ne pas revérifier un jeu qui revient d'une recherche à l'autre (« zel », « zeld »…).
 * Cache propre à l'isolate (optimisation, pas une garantie) ; seules les réponses nettes du CDN y entrent.
 */
const covers = new Map<number, string>();

function remember(id: number, url: string): string {
  if (covers.size >= COVER_MAX) covers.delete(covers.keys().next().value as number);
  covers.set(id, url);
  return url;
}

interface SteamItem {
  type: string;
  id: number;
  name: string;
  metascore?: string;
}

/** Jaquette verticale si elle existe, sinon bannière (toujours présente). */
async function coverOf(id: number): Promise<string> {
  const known = covers.get(id);
  if (known) return known;
  const cover = `${CDN}/${id}/library_600x900.jpg`;
  try {
    // Délai court : une vérification lente ne doit pas retarder toute la recherche.
    const r = await fetch(cover, { method: 'HEAD', signal: AbortSignal.timeout(COVER_TIMEOUT) });
    // Libère la connexion tout de suite (le Worker limite les connexions sortantes simultanées).
    void r.body?.cancel().catch(() => {});
    if (r.ok) return remember(id, cover);
    // 404 : la jaquette n'existe pas, inutile de redemander. Une erreur 5xx ou 429 sera revérifiée.
    if (r.status === 404 || r.status === 403) return remember(id, `${CDN}/${id}/header.jpg`);
  } catch {
    // CDN injoignable ou trop lent : la bannière sert de repli cette fois, sans être retenue
  }
  return `${CDN}/${id}/header.jpg`;
}

export const steamSource: CatalogSource = {
  images: [{ host: 'steamstatic.com', sub: true, path: '/store_item_assets/steam/apps/' }],

  async search(q) {
    const url = new URL(`https://${HOST}/api/storesearch/`);
    url.searchParams.set('term', q);
    url.searchParams.set('l', 'french');
    url.searchParams.set('cc', 'FR');
    const d = await getJson<{ items?: SteamItem[] }>(url, { service: 'Steam', host: HOST });
    // Au plus 10 résultats : les vérifications de jaquette restent peu nombreuses.
    const items = (d.items ?? []).filter((g) => g.type === 'app' && Number.isInteger(g.id)).slice(0, 10);
    return Promise.all(
      items.map(
        async (g): Promise<CatalogHit> => ({
          id: String(g.id),
          name: g.name,
          image: await coverOf(g.id),
          detail: g.metascore ? `Metascore ${g.metascore}` : undefined,
        }),
      ),
    );
  },
};
