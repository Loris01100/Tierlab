import { HttpError, type Ctx, type Route } from './api';
import { LIVE, ROOM_RE } from '../shared/live';

/**
 * Routes de l'édition partagée. Chaque salle est un Durable Object (server/liveRoom.ts) désigné par un id aléatoire :
 * connaître le lien suffit pour lire et modifier la liste (pas de comptes).
 * Les requêtes sont transmises telles quelles à l'objet, qui lit l'action à la fin du chemin.
 */

/** Champs utilisés de la liaison Durable Object (wrangler.jsonc : durable_objects.bindings). */
interface RoomStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): RoomStub;
}

function stub(ctx: Ctx, room: string): RoomStub {
  const ns = ctx.env.LIVE as RoomNamespace | undefined;
  if (!ns) throw new HttpError(500, 'Configuration manquante : LIVE');
  return ns.get(ns.idFromName(room));
}

function roomOf(ctx: Ctx): RoomStub {
  const room = ctx.params.room;
  if (!ROOM_RE.test(room)) throw new HttpError(404, 'Lien de partage invalide');
  return stub(ctx, room);
}

/** 32 caractères base 36 : impossible à deviner (≈ 165 bits). */
function newRoomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}

const forward = (ctx: Ctx): Promise<Response> => roomOf(ctx).fetch(ctx.request);

export const liveRoutes: Route[] = [
  {
    method: 'POST',
    path: '/live',
    handler: async (ctx) => {
      const body = await ctx.request.text();
      if (body.length > LIVE.message) throw new HttpError(413, 'Liste trop volumineuse');
      const room = newRoomId();
      const r = await stub(ctx, room).fetch('https://room/init', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) return r;
      return { room };
    },
  },
  { method: 'GET', path: '/live/:room/info', handler: forward },
  { method: 'GET', path: '/live/:room/ws', handler: forward },
  { method: 'GET', path: '/live/:room/img/:id', handler: forward },
  { method: 'POST', path: '/live/:room/img/:id', handler: forward },
];
