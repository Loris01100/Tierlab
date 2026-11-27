import { HttpError } from './api';

/** Outils communs aux appels sortants vers les API publiques. */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Les réponses des catalogues changent peu : le navigateur peut les réutiliser (moins d'appels, moins de quota consommé). */
export const CACHE_SHORT = 'public, max-age=3600';
export const CACHE_LONG = 'public, max-age=86400';

/**
 * Certaines API demandent un User-Agent identifiant l'application (Open Library notamment).
 * Volontairement générique : aucune donnée personnelle.
 */
const UA = 'Tierlab/1.0 (tier-list maker)';

/** Durée par défaut du cache CDN des appels sortants (secondes). */
export const EDGE_TTL = 3600;

/** Option `cf` propre aux Workers (absente des types `RequestInit` de Node). */
export type EdgeInit = RequestInit & {
  cf?: { cacheEverything: boolean; cacheTtlByStatus: Record<string, number> };
};

/**
 * Cache CDN Cloudflare d'un fetch sortant : seules les réponses 2xx sont gardées `ttl` secondes,
 * jamais les erreurs ni les quotas dépassés (TTL négatif = pas de cache). Ignoré hors Cloudflare.
 */
export function edgeCache(ttl: number): EdgeInit['cf'] {
  return { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-599': -1 } };
}

interface GetOptions {
  /** Nom affiché dans les messages d'erreur (« AniList injoignable »). */
  service: string;
  /** Hôte attendu : refuse toute URL construite vers un autre domaine. */
  host: string;
  /** Réessais sur 429 et 5xx (défaut 2), avec une attente croissante. */
  retries?: number;
  /** Corps JSON : la requête devient un POST (API GraphQL). */
  body?: unknown;
  /** Durée du cache CDN des GET (défaut EDGE_TTL). Les POST ne sont jamais mis en cache. */
  cacheTtl?: number;
  /** Contourne le cache CDN (réponse en cache périmée ou erronée, ex. quota Deezer renvoyé en 200). */
  fresh?: boolean;
}

/** GET (ou POST si `body`) JSON borné : vérifie l'hôte, réessaie quelques fois sur quota ou panne, traduit les erreurs en HttpError. */
export async function getJson<T>(url: URL, { service, host, retries = 2, body, cacheTtl = EDGE_TTL, fresh = false }: GetOptions): Promise<T> {
  if (url.protocol !== 'https:' || url.host !== host) throw new HttpError(500, `URL ${service} inattendue`);
  for (let attempt = 0; ; attempt++) {
    const init: EdgeInit =
      body === undefined
        ? { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA }, ...(fresh ? { cache: 'no-store' } : { cf: edgeCache(cacheTtl) }) }
        : {
            method: 'POST',
            headers: { Accept: 'application/json', 'User-Agent': UA, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          };
    let r: Response;
    try {
      r = await fetch(url, init);
    } catch {
      throw new HttpError(502, `${service} injoignable`);
    }
    if ((r.status === 429 || r.status >= 500) && attempt < retries) {
      void r.body?.cancel().catch(() => {});
      // Retry-After en secondes quand il est fourni, plafonné : on ne fait pas patienter le navigateur indéfiniment.
      const after = Number(r.headers.get('Retry-After'));
      await sleep(Math.min(after > 0 ? after * 1000 : 1000 * (attempt + 1), 3000));
      continue;
    }
    if (r.status === 404) throw new HttpError(404, `Introuvable sur ${service}`);
    if (r.status === 429) throw new HttpError(429, `${service} limite les requêtes, réessayez dans un instant.`);
    if (!r.ok) throw new HttpError(502, `${service} a répondu ${r.status}`);
    return (await r.json().catch(() => {
      throw new HttpError(502, `Réponse ${service} illisible`);
    })) as T;
  }
}
