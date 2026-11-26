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

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await handleApi(request, env)) ?? env.ASSETS.fetch(request);
  },
};
