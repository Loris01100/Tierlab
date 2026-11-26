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

interface GetOptions {
  /** Nom affiché dans les messages d'erreur (« AniList injoignable »). */
  service: string;
  /** Hôte attendu : refuse toute URL construite vers un autre domaine. */
  host: string;
  /** Réessais sur 429 et 5xx (défaut 2), avec une attente croissante. */
  retries?: number;
  /** Corps JSON : la requête devient un POST (API GraphQL). */
  body?: unknown;
}

/** GET (ou POST si `body`) JSON borné : vérifie l'hôte, réessaie quelques fois sur quota ou panne, traduit les erreurs en HttpError. */
export async function getJson<T>(url: URL, { service, host, retries = 2, body }: GetOptions): Promise<T> {
  if (url.protocol !== 'https:' || url.host !== host) throw new HttpError(500, `URL ${service} inattendue`);
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', 'User-Agent': UA, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
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

/** Minuscules sans accents, pour comparer des noms saisis (« pokemon » trouve « Pokémon »). */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
