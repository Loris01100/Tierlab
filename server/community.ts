import type { Ctx, Handler, Route } from './api';
import { objectStub } from './objects';
import { cleanPublish, packPublish, PACKED, readBody, readToken } from './publish';

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

/** Envoie à l'objet un corps déjà validé, avec l'adresse du client (limite par adresse, empreinte seulement). */
function forwardBody(ctx: Ctx, type: string, body: string | Uint8Array): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': type };
  const ip = ctx.request.headers.get('CF-Connecting-IP');
  if (ip) headers['CF-Connecting-IP'] = ip;
  return objectStub(ctx.env, 'GALLERY', 'main').fetch(new Request(ctx.request.url, { method: 'POST', headers, body }));
}

/**
 * Publication et mise à jour : lecture, décodage et vérification des images ici, dans le Worker (sans état,
 * en parallèle), pour ne pas bloquer le Durable Object unique de la galerie (voir server/publish.ts).
 */
const publishClean = async (ctx: Ctx): Promise<Response> => forwardBody(ctx, PACKED, packPublish(cleanPublish(await readBody(ctx))));

/** Retrait : seul le jeton est transmis. */
const removeClean = async (ctx: Ctx): Promise<Response> =>
  forwardBody(ctx, 'application/json', JSON.stringify({ token: readToken(await readBody(ctx, 4096)) }));

export const communityRoutes: Route[] = routesFor({
  list: forward,
  publish: publishClean,
  get: forward,
  img: forward,
  thumb: forward,
  copy: forward,
  report: forward,
  update: publishClean,
  remove: removeClean,
});
