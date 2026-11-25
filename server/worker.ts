import { handleApi } from './routes';

/**
 * Point d'entrée du Worker Cloudflare (voir wrangler.jsonc).
 * Les fichiers de dist/ sont servis directement par Cloudflare ; seules les URL /api/* passent par ici.
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
