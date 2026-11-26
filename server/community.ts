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
  copy: ['POST', '/community/:id/copy'],
  report: ['POST', '/community/:id/report'],
  update: ['POST', '/community/:id/update'],
  remove: ['POST', '/community/:id/delete'],
} as const satisfies Record<string, readonly [Route['method'], string]>;

export type CommunityAction = keyof typeof ROUTES;

/** Les routes de la galerie avec un gestionnaire par action (le type impose qu'aucune ne manque). */
export function routesFor(handlers: Record<CommunityAction, Handler>): Route[] {
  return (Object.keys(ROUTES) as CommunityAction[]).map((k) => ({ method: ROUTES[k][0], path: ROUTES[k][1], handler: handlers[k] }));
}

const forward = (ctx: Ctx): Promise<Response> => objectStub(ctx.env, 'GALLERY', 'main').fetch(ctx.request);

export const communityRoutes: Route[] = routesFor({
  list: forward,
  publish: forward,
  get: forward,
  img: forward,
  copy: forward,
  report: forward,
  update: forward,
  remove: forward,
});
