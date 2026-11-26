# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tierlab is a tier-list maker: Svelte 5 (runes) + TypeScript SPA, data stored locally in IndexedDB (Dexie), plus a small `/api` backend deployed as a Cloudflare Worker (`mainlist`, custom domain `mainlist.reesch.com`). Code comments, UI strings and the README are in French — keep new ones in French.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173; /api runs in workerd via @cloudflare/vite-plugin
npm run check    # svelte-check on src/ + shared/, then tsc on server/ + vite.config.ts (tsconfig.node.json)
npm run build    # production build into dist/
npm run preview  # serve the build (dist/client + dist/mainlist worker) with /api
npm run deploy   # build + wrangler deploy (needs `npx wrangler login` once)
```

There is no test suite or linter; `npm run check` is the verification step.

To see the site: `npm run dev` then open http://localhost:5173. In VS Code, F5 (`.vscode/launch.json`) starts the dev server and opens Edge/Chrome with the debugger; Ctrl+Shift+B runs the `dev` task alone. Claude Code previews use `.claude/launch.json` (`tierlab-dev` on 5173, `tierlab-preview` on 4173 — run `npm run build` first).

## Architecture

### Two TypeScript projects
- `tsconfig.json`: browser code (`src/`, `shared/`), DOM libs.
- `tsconfig.node.json`: server code (`server/`, `vite.config.ts`), Node types, no DOM.
- `shared/` holds types used by both sides (e.g. `shared/music.ts` for `/api/music` payloads) and must stay environment-neutral. `shared/rules.ts` holds `LIMITS` and `isColor` (re-exported by `src/lib/constants.ts` / `utils.ts`).

### `/api` backend — one router, two hosts
- `server/api.ts` is a tiny router built on web-standard `Request`/`Response` (`Route` = method + path with `:params` + handler). Handlers return a JSON-serializable value or a full `Response` (e.g. image proxy); throw `HttpError(status, msg)` for client-facing errors.
- `server/routes.ts` aggregates all `Route[]` into `handleApi`.
- Production: `server/worker.ts` (Cloudflare). `wrangler.jsonc` routes only `/api/*` through the Worker; everything else is static from `dist/` with SPA fallback.
- Dev/preview: `@cloudflare/vite-plugin` (`vite.config.ts`) runs `server/worker.ts` in workerd, Durable Objects and WebSockets included (local DO state in `.wrangler/state`). There is no Node adapter any more.
- The browser never calls external services directly. Secrets go in `.env.local` or `.dev.vars` **without** the `VITE_` prefix (read by Wrangler through the plugin; on Cloudflare, `wrangler secret put`).
- Adding a service: new module in `server/` exporting `Route[]` (model: `server/deezer.ts`), register it in `server/routes.ts`, call it from the front with `apiGet()` (`src/lib/api.ts`).
- `server/deezer.ts`: public Deezer API (no key), 50 req / 5 s quota handled server-side with wait-and-retry.
- `server/media.ts`: the single image proxy `/api/image?url=`; each module declares its `ImageHost[]` allowlist (host, subdomains, path prefix), redirects are re-checked per hop.
- `server/http.ts`: shared outgoing helpers (`getJson` with host check + bounded retry on 429/5xx, `sleep`, cache constants, `fold`).
- Catalogues (search → tiles): contract and category list in `shared/catalog.ts` (`CATALOGS`, `CatalogHit`); generic routes `/api/catalog/:source/search` and `/lists/:list` in `server/catalog.ts`; one `CatalogSource` per category (`server/tyradex.ts`, `anilist.ts` — GraphQL via `getJson({ body })`, `openlibrary.ts`), registered in `server/routes.ts` (typed `Record<CatalogId, …>`, so a missing one fails `npm run check`). Front: `src/lib/catalog.ts` + `CatalogModal.svelte` (single « Catalogues » dock button; Music is a special tab rendering `MusicPanel.svelte`, not a `CatalogSource`, because of its artist → releases → albums/tracks flow). Adding a category needs no front change.

### Live collaboration (several people on one list)
- One room = one Durable Object `LiveRoom` (`server/liveRoom.ts`, binding `LIVE`, SQLite storage, hibernatable WebSockets); routes in `server/live.ts`: `POST /api/live` (create from a `LiveBoard`), `GET /live/:room/info`, `GET /live/:room/ws`, `GET|POST /live/:room/img/:id`. The random room id is the only credential.
- `shared/live.ts`: `Op` union (intent-based, idempotent: move/remove/add/replace/dup/tier*/reset/title), `applyOp` (same code client and server), `cleanOp`/`cleanBoard` (server-side validation), WebSocket messages.
- Every `Editor` mutation builds an `Op` and goes through `#run` (`applyOp` on its own `$state` + `live?.send` + `touch`), in solo mode too. A new mutation = a new `Op` kind in `shared/live.ts`, never a direct state edit.
- `src/lib/live.svelte.ts` (`LiveLink`): server-confirmed state + pending ops; on every remote op it recomputes confirmed+pending and calls `Editor.adopt()`. Images are uploaded before the op that references them; missing ones are fetched and set with `Editor.setBlob()`. Drag moves stay local (`placeLive`) until `Editor.dropped()` sends the final position.
- A linked list keeps a local copy with `TierList.live = room` (Dexie v2 index `live`); `#/live/<room>` (`LiveJoin.svelte`) finds or creates it. Undo is disabled in live mode (`pushHistory` is a no-op).

### Community gallery (published lists)
- All published lists live in one Durable Object `Gallery` (`server/gallery.ts`, binding `GALLERY`, instance `main`, SQLite tables `list` / `img` / `mark`). Route table declared once in `server/community.ts` (`routesFor`): the Worker forwards each route to the object, which runs the same paths through its own `createApi`.
- Publishing sends `PublishBody` (`shared/community.ts`): pseudo + the list in `SharedData` format (images as data URLs, validated server-side: type, file signature, size). Returns `{ id, token }`; the token (stored hashed) is kept in localStorage `tierlab-published` keyed by local list id (`src/lib/community.svelte.ts`) and is needed for update/delete. Optional secret `ADMIN_TOKEN` can delete any list.
- No accounts: per-IP-hash limits (10 publications/hour, one copy and one report counted per IP), hidden at 3 reports.
- Front: `Library.svelte` tab `community` (`#/community`) renders `CommunityGrid.svelte`; `#/community/<id>` → `CommunityView.svelte` (read-only board, « Faire ma version » = `POST /copy` → `saveShared()` in `share.ts`). Publish/update/remove from `ShareModal.svelte`.

### Front end
- Hash routing (`src/lib/router.svelte.ts`): `#/` → `Library.svelte` (`#/community` = its community tab, `#/community/<id>` → `CommunityView.svelte`), `#/list/<id>` → `EditorPage.svelte` (loads from IndexedDB) → `Editor.svelte`, `#/live/<room>` → `LiveJoin.svelte`.
- `src/lib/editor.svelte.ts` — the `Editor` class is the reactive state of an open list (`$state` fields). All mutations go through its methods, which push an undo snapshot (JSON of `title`/`tiers`/`pool`) and call `touch()` → debounced (400 ms) save to IndexedDB. Drag state (`dragId`, `overZone`, `overTrash`) also lives here and is read by components. The unranked pool zone id is `POOL`.
- `src/lib/drag.ts`: custom Pointer Events drag-and-drop (mouse + touch), no library.
- Library (`Library.svelte`): search, sort (pref `tierlab-sort`), card previews read the first tiles via `previewItems()` (`db.ts`), « Démarrer vite » shortcuts create a list and hand the catalog tab to the editor through `pendingCatalog` (`src/lib/catalog.ts`).
- Theme: `src/lib/theme.svelte.ts` (auto / clair / sombre, pref `tierlab-theme`, sets `data-theme` on `<html>`), imported once in `main.ts`.
- Single global stylesheet `src/app.css`.

### Storage model (`src/lib/db.ts`)
- `lists` table: list structure only (title, tiers, item-id ordering, pool) — light, what the library reads.
- `items` table: tiles indexed by `listId`; images are `Blob`s (WebP, shrunk to 320 px by `src/lib/images.ts`), never base64.
- **Items are immutable**: editing a tile creates a new item with a new id (this keeps undo trivial). Orphaned items are cleaned up when a list is opened.
- Schema changes: add `this.version(2).stores(...).upgrade(...)` in `db.ts`; never modify version 1.

### Share format (`src/lib/share.ts`)
JSON exchange format `SharedData` (`v: 1`) with images as base64 data URLs, converted to Blobs on import. It must stay compatible with the original prototype's format (the README mentions `MainList_v1.html`, which is no longer in the repo).

## Project skills (`.claude/skills/`)
Load the matching skill before working on that part of the stack:
- `svelte5-runes` — components and `.svelte.ts` reactive state.
- `dexie-storage` — IndexedDB schema, saves, Blob images, `SharedData` format.
- `worker-api` — `/api` routes, external services, secrets, Cloudflare deployment.
- `typescript-conventions` — TS rules, code organisation, language, done checklist.
- `ui-design` — visual design: `app.css` tokens, components, motion, mobile, light/dark.
