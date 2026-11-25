/**
 * Mini routeur pour les appels d'API côté serveur, basé sur les objets web standards Request / Response.
 * Le même code tourne dans le Worker Cloudflare (server/worker.ts) et dans Vite en dev / preview (server/node.ts).
 * Les clés secrètes restent ici : le navigateur n'appelle jamais les services externes directement.
 *
 * Ajouter un service : écrire un module qui exporte des Route[] et l'ajouter dans server/routes.ts.
 */

export type Env = Record<string, unknown>;

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  env: Env;
  request: Request;
}

/** Valeur renvoyée en JSON, ou une Response complète (ex. image). */
export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: 'GET' | 'POST';
  /** Chemin relatif à /api, avec paramètres : '/music/albums/:id/tracks'. */
  path: string;
  handler: Handler;
}

/** Erreur transmise telle quelle au client, avec son code HTTP. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const API_PREFIX = '/api';

function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/\/:(\w+)/g, (_, k: string) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { re: new RegExp(`^${src}/?$`), keys };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Renvoie un gestionnaire Request → Response pour les URL sous /api, ou null pour les autres. */
export function createApi(routes: Route[]) {
  const table = routes.map((r) => ({ ...r, ...compile(r.path) }));

  return async (request: Request, env: Env): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return null;
    const path = url.pathname.slice(API_PREFIX.length) || '/';

    let pathMatched = false;
    for (const r of table) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== request.method) continue;
      try {
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = await r.handler({ params, query: url.searchParams, env, request });
        return out instanceof Response ? out : json(200, out ?? null);
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { error: e.message });
        console.error('[api]', request.method, path, e);
        return json(500, { error: 'Erreur interne du serveur' });
      }
    }
    if (pathMatched) return json(405, { error: 'Méthode non autorisée' });
    return json(404, { error: 'Route inconnue' });
  };
}
