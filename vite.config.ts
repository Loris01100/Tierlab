import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * Le plugin Cloudflare exécute server/worker.ts dans le vrai runtime Workers (workerd) en dev et en preview :
 * les routes /api, les Durable Objects (édition partagée) et les WebSockets se comportent comme en production.
 * Variables serveur en local : .env.local ou .dev.vars (sans préfixe VITE_), lus par Wrangler.
 */
export default defineConfig({
  plugins: [svelte(), cloudflare()],
});
