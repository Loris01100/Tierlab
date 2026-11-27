import { handleApi } from './routes';

export { Gallery } from './gallery';
export { LiveRoom } from './liveRoom';

/**
 * Point d'entrée du Worker Cloudflare (voir wrangler.jsonc), aussi exécuté en dev par @cloudflare/vite-plugin.
 * Les fichiers de dist/ sont servis directement par Cloudflare ; seules les URL /api/* passent par ici.
 * LiveRoom est le Durable Object des salles d'édition partagée (liaison LIVE), Gallery celui de la galerie communautaire (GALLERY).
 */

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Cache du datacenter Cloudflare (caches.default), décrit localement : pas de @cloudflare/workers-types. */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * Durée maximale d'une copie dans le cache du datacenter (1 jour), même si Cache-Control annonce plus long.
 * Une liste retirée ou masquée de la galerie ne doit pas rester servie des mois depuis le cache.
 */
const EDGE_MAX = 86400;

function edgeCache(): EdgeCache | null {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
}

/** Une réponse se garde au datacenter si elle est réussie et déclarée publique par sa route. */
function storable(r: Response): boolean {
  const cc = r.headers.get('Cache-Control') ?? '';
  return r.status === 200 && /\bpublic\b/.test(cc) && !r.headers.has('Set-Cookie') && r.headers.get('Vary') !== '*';
}

/** Copie à stocker : Cache-Control d'origine pour le navigateur, s-maxage borné pour le datacenter. */
function edgeCopy(r: Response): Response {
  const cc = r.headers.get('Cache-Control') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0);
  const copy = new Response(r.body, r);
  copy.headers.set('Cache-Control', `${cc}, s-maxage=${Math.min(maxAge, EDGE_MAX)}`);
  return copy;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // Cache partagé entre les visiteurs d'un même datacenter : seulement les GET (pas les WebSockets des salles).
    const cache = request.method === 'GET' && !request.headers.has('Upgrade') ? edgeCache() : null;
    if (cache) {
      const hit = await cache.match(request).catch(() => undefined);
      if (hit) return hit;
    }
    const res = await handleApi(request, env);
    if (!res) return env.ASSETS.fetch(request);
    if (cache && storable(res)) ctx.waitUntil(cache.put(request, edgeCopy(res.clone())).catch(() => {}));
    return res;
  },
};
