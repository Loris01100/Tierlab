import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Mini routeur pour les appels d'API côté serveur, monté sur /api par le plugin Vite (dev et preview).
 * Les clés secrètes restent ici : le navigateur n'appelle jamais les services externes directement.
 *
 * Ajouter un service : écrire un module qui exporte des Route[] et l'ajouter dans createApi().
 */

export type Env = Record<string, string | undefined>;

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  env: Env;
  res: ServerResponse;
}

/** Valeur renvoyée en JSON, ou undefined si le handler a déjà écrit la réponse (ex. image). */
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

type Next = (err?: unknown) => void;

function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/\/:(\w+)/g, (_, k: string) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { re: new RegExp(`^${src}/?$`), keys };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Middleware Connect : à monter sur /api (req.url est alors relatif, sans le préfixe). */
export function createApi(routes: Route[], env: Env) {
  const table = routes.map((r) => ({ ...r, ...compile(r.path) }));

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    let pathMatched = false;
    for (const r of table) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const out = await r.handler({ params, query: url.searchParams, env, res });
        if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
      } catch (e) {
        if (res.headersSent) return void res.end();
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
        console.error('[api]', req.method, url.pathname, e);
        sendJson(res, 500, { error: 'Erreur interne du serveur' });
      }
      return;
    }
    if (pathMatched) return sendJson(res, 405, { error: 'Méthode non autorisée' });
    if (url.pathname.startsWith('/')) return sendJson(res, 404, { error: 'Route inconnue' });
    next();
  };
}
