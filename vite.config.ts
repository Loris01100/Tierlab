import { defineConfig, loadEnv, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Env } from './server/api';
import { nodeApi } from './server/node';

/** Monte les routes /api sur le serveur de dev et sur `vite preview`. Les secrets ne quittent pas le serveur. */
function api(env: Env): Plugin {
  const handler = nodeApi(env);
  return {
    name: 'tierlab-api',
    configureServer: (server) => void server.middlewares.use('/api', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/api', handler),
  };
}

export default defineConfig(({ mode }) => {
  // Préfixe '' : charge toutes les variables de .env / .env.local, y compris celles sans VITE_.
  // Seules les variables VITE_* sont exposées au navigateur ; les autres restent côté serveur.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [svelte(), api(env)],
  };
});
