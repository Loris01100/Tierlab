# Tierlab

Créateur de tier listes : Svelte 5 + TypeScript + IndexedDB (Dexie), construit avec Vite.

## Commandes

```bash
npm install      # dépendances
npm run dev      # serveur de dev sur http://localhost:5173
npm run check    # vérification des types (svelte-check)
npm run build    # build de production dans dist/
npm run cf:dev   # build puis Worker Cloudflare en local (wrangler dev)
npm run deploy   # build puis déploiement sur https://mainlist.reesch.com
```

## Déploiement (Cloudflare)

Un Worker Cloudflare nommé `mainlist` (voir `wrangler.jsonc`) sert les fichiers de `dist/` et répond aux routes `/api/*`
(`server/worker.ts`). Domaine personnalisé : `mainlist.reesch.com` (zone `reesch.com` sur le même compte Cloudflare).
Première fois : `npx wrangler login`. Ensuite `npm run deploy` suffit.

## APIs externes

Le navigateur n'appelle jamais les services externes directement : il passe par `/api/...`. Le routeur
(`server/api.ts`) utilise les objets web standards `Request` / `Response` : il tourne dans le Worker Cloudflare en production
et, via un adaptateur Node (`server/node.ts`), dans Vite (`npm run dev` et `npm run preview`). Si un service demande une clé, elle reste
côté serveur : la mettre dans `.env.local` (voir `.env.example`, ignoré par git), sans préfixe `VITE_`.

Ajouter un service : écrire un module dans `server/` qui exporte des `Route[]` (voir `server/deezer.ts`),
l'ajouter dans `server/routes.ts`, puis l'appeler depuis le front avec `apiGet()` (`src/lib/api.ts`).

### Musique (Deezer)

Bouton **Musique** dans le dock de l'éditeur : recherche d'un artiste, choix des sorties (albums, singles et EP, compilations),
puis import d'une vignette par album ou par titre, avec la pochette et le nom.
Source : l'API publique Deezer (https://developers.deezer.com/api), gratuite, sans compte ni clé.
Quota : 50 requêtes par 5 secondes, géré par le serveur (attente et nouvel essai).

Routes : `GET /api/music/artists?q=`, `/api/music/artists/:id/albums?groups=album,single`,
`/api/music/albums/:id/tracks`, `/api/music/image?url=` (relais des pochettes, limité aux domaines Deezer).

## Structure

```
server/                    API côté serveur : routeur /api, musique (Deezer), Worker Cloudflare, adaptateur Vite
shared/                    types partagés serveur / navigateur
src/
  main.ts, App.svelte      point d'entrée, routage #/ et #/list/<id>
  app.css                  feuille de style unique (reprise du prototype)
  lib/
    types.ts               Item, Tier, TierList
    db.ts                  schéma IndexedDB (tables lists et items) et accès
    editor.svelte.ts       état réactif d'une liste : actions, annulation, sauvegarde auto
    drag.ts                glisser-déposer souris et tactile (Pointer Events)
    images.ts              réduction des images en Blob WebP, URLs objet
    api.ts                 client /api (erreurs, appels parallèles limités)
    music.ts               recherche d'artiste, discographie, titres, pochettes
    share.ts               code de partage JSON (compatible avec le prototype)
    exportImage.ts         export PNG via canvas
    effects.ts             confettis
    model.ts, constants.ts, utils.ts, router.svelte.ts, toast.svelte.ts
  components/
    Library.svelte         bibliothèque : créer, ouvrir, dupliquer, supprimer, importer
    EditorPage.svelte      chargement d'une liste depuis IndexedDB
    Editor.svelte          éditeur : en-tête, rangs, clavier, collage, dépôt de fichiers
    Row, Zone, Tile, Dock, Swatches, Modal, Icon
    modals/                rang, vignette, partage, export, nouvelle liste, import, musique
```

## Stockage

- `lists` : la structure de chaque liste (titre, rangs, ordre des vignettes). Léger, c'est ce que lit la bibliothèque.
- `items` : les vignettes, indexées par `listId`. Les images sont des `Blob` (pas de base64), réduites à 320 px.
- Les vignettes sont immuables : modifier une vignette en crée une nouvelle, ce qui rend l'annulation simple.
  Les vignettes orphelines sont nettoyées à l'ouverture de la liste.
- Pour faire évoluer le schéma, ajouter `this.version(2)` dans `db.ts` sans modifier la version 1.

`MainList_v1.html` est le prototype d'origine, gardé comme référence.
