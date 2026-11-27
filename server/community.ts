import type { Ctx, Handler, Route } from './api';
import { objectStub } from './objects';

/**
 * Routes de la galerie communautaire. Toutes les listes publiées vivent dans un seul Durable Object (server/gallery.ts),
 * qui reçoit la requête telle quelle et la traite avec les mêmes chemins (routesFor).
 */

const ROUTES = {
  list: ['GET', '/community'],
  publish: ['POST', '/community'],
  get: ['GET', '/community/:id'],
  img: ['GET', '/community/:id/img/:item'],
  thumb: ['GET', '/community/:id/thumb'],
  copy: ['POST', '/community/:id/copy'],
  report: ['POST', '/community/:id/report'],
  update: ['POST', '/community/:id/update'],
  remove: ['POST', '/community/:id/delete'],
} as const satisfies Record<string, readonly [Route['method'], string]>;

export type CommunityAction = keyof typeof ROUTES;

/**
 * Cache-Control des lectures JSON qui peuvent être partagées. La première page de la galerie est la plus demandée :
 * 30 s de cache (navigateur et datacenter, voir server/worker.ts) absorbent les pics, au prix d'une nouvelle
 * publication visible avec au plus 30 s de retard. Les autres réponses JSON restent en no-store.
 */
const CACHE: Partial<Record<CommunityAction, string>> = { list: 'public, max-age=30' };

/** Les routes de la galerie avec un gestionnaire par action (le type impose qu'aucune ne manque). */
export function routesFor(handlers: Record<CommunityAction, Handler>): Route[] {
  return (Object.keys(ROUTES) as CommunityAction[]).map((k) => ({
    method: ROUTES[k][0],
    path: ROUTES[k][1],
    cache: CACHE[k],
    handler: handlers[k],
  }));
}

const forward = (ctx: Ctx): Promise<Response> => objectStub(ctx.env, 'GALLERY', 'main').fetch(ctx.request);

export const communityRoutes: Route[] = routesFor({
  list: forward,
  publish: forward,
  get: forward,
  img: forward,
  thumb: forward,
  copy: forward,
  report: forward,
  update: forward,
  remove: forward,
});
