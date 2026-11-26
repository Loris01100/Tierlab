import { HttpError, type Ctx, type Route } from './api';
import { objectStub, randomId, type ObjectStub } from './objects';
import { LIVE, ROOM_RE } from '../shared/live';

/**
 * Routes de l'édition partagée. Chaque salle est un Durable Object (server/liveRoom.ts) désigné par un id aléatoire :
 * connaître le lien suffit pour lire et modifier la liste (pas de comptes).
 * Les requêtes sont transmises telles quelles à l'objet, qui lit l'action à la fin du chemin.
 */

const roomStub = (ctx: Ctx, room: string): ObjectStub => objectStub(ctx.env, 'LIVE', room);

function checkedRoom(ctx: Ctx): ObjectStub {
  const room = ctx.params.room;
  if (!ROOM_RE.test(room)) throw new HttpError(404, 'Lien de partage invalide');
  return roomStub(ctx, room);
}

const forward = (ctx: Ctx): Promise<Response> => checkedRoom(ctx).fetch(ctx.request);

export const liveRoutes: Route[] = [
  {
    method: 'POST',
    path: '/live',
    handler: async (ctx) => {
      const body = await ctx.request.text();
      if (body.length > LIVE.message) throw new HttpError(413, 'Liste trop volumineuse');
      const room = randomId(32);
      const r = await roomStub(ctx, room).fetch('https://room/init', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) return r;
      return { room };
    },
  },
  { method: 'GET', path: '/live/:room/info', handler: forward },
  { method: 'GET', path: '/live/:room/ws', handler: forward },
  { method: 'GET', path: '/live/:room/img/:id', handler: forward },
  { method: 'POST', path: '/live/:room/img/:id', handler: forward },
];
