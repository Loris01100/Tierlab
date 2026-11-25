import { defineConfig, loadEnv, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createApi, type Env } from './server/api';
import { musicRoutes } from './server/deezer';

/** Monte les routes /api sur le serveur de dev et sur `vite preview`. Les secrets ne quittent pas le serveur. */
function api(env: Env): Plugin {
  const handler = createApi([...musicRoutes], env);
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
