---
name: worker-api
description: Règles du backend /api de Tierlab (server/, shared/, Cloudflare Worker exécuté aussi en dev par @cloudflare/vite-plugin, Durable Object des salles partagées). À charger avant d'ajouter ou modifier une route /api, d'appeler un service externe, de gérer un secret, ou de toucher à wrangler.jsonc, worker.ts, liveRoom.ts ou vite.config.ts.
---

# Backend `/api` (Cloudflare Worker, même code en dev via Vite)

Le routeur (`server/api.ts`) tourne dans le Worker (`server/worker.ts`), en production comme en dev / preview : `@cloudflare/vite-plugin` exécute le Worker dans workerd sous Vite. Il n'y a plus d'adaptateur Node.

## Contraintes d'exécution (Workers)
- Uniquement des API web standard dans les routes : `fetch`, `Request`, `Response`, `URL`, `URLSearchParams`, `Headers`, `crypto.subtle`, `crypto.randomUUID`, `TextEncoder`, streams web.
- **Interdit** dans un module de route : `node:*`, `fs`, `path`, `process.env`, `Buffer`, `__dirname`. Seul `vite.config.ts` peut importer `node:*`.
- APIs propres aux Workers (Durable Objects, `WebSocketPair`…) : décrire localement une interface minimale des champs utilisés (modèle : `server/liveRoom.ts`), sans `@cloudflare/workers-types` (conflit avec les types Node de `tsconfig.node.json`).
- Pas d'état global mutable comptant sur la persistance entre requêtes : un isolate Worker peut être recyclé à tout moment ou dupliqué. Un cache mémoire n'est qu'une optimisation opportuniste.
- Lire la configuration depuis `ctx.env` (Worker : variables/secrets Cloudflare ; dev : `.env.local` ou `.dev.vars`, lus par Wrangler). Typage : `ctx.env.MA_CLE as string | undefined`, et `HttpError(500, 'Configuration manquante : MA_CLE')` si absente.

## Secrets
- Jamais de préfixe `VITE_` pour un secret (il serait injecté dans le bundle navigateur).
- Dev : `.env.local` (ignoré par git) + entrée sans valeur dans `.env.example`. Production : `npx wrangler secret put MA_CLE`. Ne jamais mettre un secret dans `wrangler.jsonc`.
- Ne jamais renvoyer un secret, une URL contenant une clé, ou une erreur brute d'un service externe au client.

## Ajouter un service
1. Types d'échange dans `shared/<service>.ts` (neutre : ni DOM, ni Node, seulement des `interface`/`type`). Le front et le serveur importent ces types.
2. Module `server/<service>.ts` qui exporte `export const xxxRoutes: Route[] = [...]` — modèle : `server/deezer.ts` (types bruts du fournisseur préfixés et limités aux champs utilisés, fonction `fetch` centrale qui traduit les erreurs, puis mapping vers les types de `shared/`).
3. L'enregistrer dans `server/routes.ts` : `createApi([...musicRoutes, ...xxxRoutes])`.
4. Côté front, un module `src/lib/<service>.ts` qui appelle `apiGet<T>('/chemin', params, signal)` (`src/lib/api.ts`). Le navigateur n'appelle jamais le service externe directement.

## Écrire un handler
- Retourner une valeur sérialisable en JSON (envoyée en 200) ou une `Response` complète (binaire, en-têtes de cache spécifiques).
- Erreurs destinées à l'utilisateur : `throw new HttpError(status, 'message en français')`. Tout autre throw devient un 500 générique journalisé — ne pas compter dessus pour un message utile.
- Codes : 400 paramètre invalide, 404 introuvable, 429 quota, 502 service externe en échec/injoignable, 500 configuration serveur.
- **Valider chaque entrée** (`ctx.params`, `ctx.query`, corps) : regex stricte pour les ids (cf. `ID_RE`), longueurs bornées, valeurs par défaut explicites. Corps POST : `await ctx.request.json().catch(() => { throw new HttpError(400, 'JSON invalide'); })` puis vérifier la forme.
- Mapper la réponse du fournisseur vers un type `shared/` réduit : ne pas renvoyer l'objet brut.

## Appels sortants
- Construire les URLs avec `new URL()` + `searchParams`, jamais par concaténation de saisie utilisateur ; vérifier l'hôte attendu avant le `fetch` (cf. `dz()`).
- Tout proxy (images, fichiers) doit restreindre les hôtes à une liste blanche et le protocole à `https:` (cf. `/api/music/image`) pour éviter le SSRF / relais ouvert ; vérifier aussi le `Content-Type` renvoyé.
- Quotas : réessai borné avec attente (`sleep`) comme dans `deezer.ts`, jamais de boucle infinie. Paralléliser avec une limite (`mapLimit` côté front, ou équivalent côté serveur) plutôt qu'un `Promise.all` sur des centaines d'URLs.
- Réponses JSON : `Cache-Control: no-store` par défaut (via `json()`). Une `Response` d'image peut porter un cache long (`public, max-age=…`).

## Déploiement
- `wrangler.jsonc` : seules les URL `/api/*` passent par le Worker (`run_worker_first`) ; le reste est servi depuis `dist/` avec repli SPA. Ne pas élargir ce motif sans raison.
- `npm run dev` et `npm run preview` utilisent déjà le vrai runtime ; `npx wrangler deploy --dry-run` après `npm run build` vérifie les liaisons (`LIVE`, `ASSETS`).
- Durable Objects : toute nouvelle classe exige une entrée `migrations` (nouveau `tag`, `new_sqlite_classes`) dans `wrangler.jsonc` ; ne jamais modifier une migration déjà déployée.

## Vérification
`npm run check` (le second passage `tsc -p tsconfig.node.json` couvre `server/`), puis appeler la route via `npm run dev` (`curl http://localhost:5173/api/...`).
