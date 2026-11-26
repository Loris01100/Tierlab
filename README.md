# Tierlab

Créateur de tier listes : Svelte 5 + TypeScript + IndexedDB (Dexie), construit avec Vite.

## Commandes

```bash
npm install      # dépendances
npm run dev      # serveur de dev sur http://localhost:5173 (le Worker /api tourne dans workerd)
npm run check    # vérification des types (svelte-check)
npm run build    # build de production dans dist/ (client/ et worker mainlist/)
npm run preview  # sert le build, Worker compris
npm run deploy   # build puis déploiement sur https://mainlist.reesch.com
```

## Déploiement (Cloudflare)

Un Worker Cloudflare nommé `mainlist` (voir `wrangler.jsonc`) sert les fichiers de `dist/` et répond aux routes `/api/*`
(`server/worker.ts`). Domaine personnalisé : `mainlist.reesch.com` (zone `reesch.com` sur le même compte Cloudflare).
Première fois : `npx wrangler login`. Ensuite `npm run deploy` suffit.

## APIs externes

Le navigateur n'appelle jamais les services externes directement : il passe par `/api/...`. Le routeur
(`server/api.ts`) utilise les objets web standards `Request` / `Response` : il tourne dans le Worker Cloudflare en production
et, grâce à `@cloudflare/vite-plugin`, dans le même runtime (workerd) sous Vite (`npm run dev` et `npm run preview`). Si un service demande une clé, elle reste
côté serveur : la mettre dans `.env.local` ou `.dev.vars` (ignorés par git), sans préfixe `VITE_` ; en production, `npx wrangler secret put`.

Ajouter un service : écrire un module dans `server/` qui exporte des `Route[]` (voir `server/deezer.ts`),
l'ajouter dans `server/routes.ts`, puis l'appeler depuis le front avec `apiGet()` (`src/lib/api.ts`).
Pour une simple catégorie « recherche → vignettes », préférer un catalogue (ci-dessous).

Toutes les images externes passent par un relais unique, `GET /api/image?url=` (`server/media.ts`), limité aux domaines
déclarés par chaque module (redirections revérifiées à chaque étape).

### Musique (Deezer)

Onglet **Musique** de la modale **Catalogues** (dock de l'éditeur) : recherche d'un artiste, choix des sorties (albums, singles et EP, compilations),
puis import d'une vignette par album ou par titre, avec la pochette et le nom.
Source : l'API publique Deezer (https://developers.deezer.com/api), gratuite, sans compte ni clé.
Quota : 50 requêtes par 5 secondes, géré par le serveur (attente et nouvel essai).

Routes : `GET /api/music/artists?q=`, `/api/music/artists/:id/albums?groups=album,single`,
`/api/music/albums/:id/tracks`.

### Catalogues (Pokémon, anime, manga, personnages, livres)

Bouton **Catalogues** dans le dock : choix d'une catégorie (la musique y est un onglet à part, avec son propre parcours), recherche ou liste prédéfinie (génération Pokémon, top 100…),
cases à cocher (la sélection est conservée d'une recherche et d'une catégorie à l'autre), puis import en vignettes image + nom.
Sources publiques, sans clé :

| Catégorie | Source | Module |
|---|---|---|
| Pokémon | Tyradex (https://tyradex.app), noms en français | `server/tyradex.ts` |
| Anime, manga, personnages | AniList, API GraphQL officielle (https://docs.anilist.co), 30 req/min | `server/anilist.ts` |
| Livres | Open Library (https://openlibrary.org) | `server/openlibrary.ts` |

Toutes les catégories partagent le même contrat (`shared/catalog.ts`) et les mêmes routes :
`GET /api/catalog/:source/search?q=` et `/api/catalog/:source/lists/:list`, qui renvoient `{ hits: CatalogHit[] }`.
Ajouter une catégorie : une entrée dans `CATALOGS` (`shared/catalog.ts`), un module serveur qui implémente `CatalogSource`
(`search`, `list` facultatif, domaines d'images), et son enregistrement dans `server/routes.ts`. La modale n'a pas à changer.

## Édition partagée (plusieurs personnes sur la même liste)

**Partager → Créer le lien partagé** envoie la liste au serveur et donne un lien `#/live/<salle>`. Toute personne qui l'ouvre
voit et modifie la même liste en temps réel ; l'en-tête affiche le nombre de personnes connectées. Pas de comptes :
connaître le lien suffit. Chaque appareil garde une copie locale (IndexedDB, champ `live` de la liste, badge « Partagée »
dans la bibliothèque) ; « Arrêter la synchro » la rend indépendante. L'annulation (Ctrl+Z) est désactivée en mode partagé.

Fonctionnement :
- une salle = un Durable Object Cloudflare (`server/liveRoom.ts`, stockage SQLite), qui fait foi : il applique les
  modifications dans l'ordre d'arrivée et les relaie par WebSocket (`GET /api/live/:salle/ws`) ;
- une modification est une opération d'intention (`shared/live.ts` : « mettre X dans tel rang à telle place », « renommer le rang »…),
  appliquée par le même code `applyOp` dans le navigateur et sur le serveur ;
- chaque client applique ses opérations tout de suite et recalcule son état à chaque opération reçue
  (état confirmé par le serveur + ses opérations pas encore acquittées), voir `src/lib/live.svelte.ts` ;
- les images partent à part (`POST /api/live/:salle/img/:id`, avant l'opération qui les utilise) et sont téléchargées
  par les autres (`GET` sur la même route).

Autres routes : `POST /api/live` (création, renvoie `{ room }`), `GET /api/live/:salle/info` (titre, 404 si le lien n'existe pas).

## Communauté (listes publiées)

La bibliothèque a deux onglets : **Mes tier listes** (`#/`, stockées sur l'appareil) et **Communauté** (`#/community`), la
galerie des listes publiées par tout le monde (recherche, tri « Récentes » / « Populaires », pages de 24).
**Partager → Publier dans la communauté** envoie une copie figée de la liste avec un pseudo facultatif. Depuis le même
appareil, on peut ensuite « Mettre à jour » ou « Retirer » la publication : le jeton reçu à la publication est gardé
dans le `localStorage` (`tierlab-published`). Une liste publiée s'ouvre en lecture seule (`#/community/<id>`) ;
« Faire ma version » la copie dans « Mes tier listes ».

Fonctionnement :
- toutes les publications vivent dans un seul Durable Object (`server/gallery.ts`, liaison `GALLERY`, SQLite : listes, images en BLOB,
  copies et signalements) ; les routes sont déclarées une fois dans `server/community.ts` ;
- la publication reprend le format du code de partage (`SharedData`, images en data URL), validé côté serveur
  (formats, signature des fichiers, 512 Ko par image, 200 images, 8 Mo au total) ;
- garde-fous sans comptes : 10 publications par heure et par adresse, une copie et un signalement comptés par adresse
  (adresses conservées seulement sous forme d'empreinte), liste masquée après 3 signalements ;
- le secret facultatif `ADMIN_TOKEN` (`npx wrangler secret put ADMIN_TOKEN`, 16 caractères minimum) remplace le jeton de
  l'auteur pour retirer n'importe quelle liste : `POST /api/community/<id>/delete` avec `{ "token": "…" }`.

Routes : `GET /api/community?q=&sort=recent|popular&page=`, `POST /api/community` (publication, renvoie `{ id, token }`),
`GET /api/community/:id`, `GET /api/community/:id/img/:vignette`, `POST /api/community/:id/copy|report|update|delete`.

## Structure

```
server/                    API côté serveur : routeur /api, relais d'images, musique (Deezer), catalogues, salles partagées, galerie, Worker
shared/                    types et règles partagés serveur / navigateur (live.ts : édition partagée, community.ts : galerie)
src/
  main.ts, App.svelte      point d'entrée, routage #/, #/community[/<id>], #/list/<id> et #/live/<salle>
  app.css                  feuille de style unique (reprise du prototype)
  lib/
    types.ts               Item, Tier, TierList
    db.ts                  schéma IndexedDB (tables lists et items) et accès
    editor.svelte.ts       état réactif d'une liste : actions, annulation, sauvegarde auto
    drag.ts                glisser-déposer souris et tactile (Pointer Events)
    images.ts              réduction des images en Blob WebP, URLs objet
    api.ts                 client /api (erreurs, appels parallèles limités)
    music.ts               recherche d'artiste, discographie, titres
    catalog.ts             catalogues : recherche et listes prédéfinies
    share.ts               code de partage JSON (compatible avec le prototype)
    live.svelte.ts         édition partagée : connexion WebSocket, opérations en attente, images
    community.svelte.ts    galerie : publier, mettre à jour, retirer, parcourir, copier
    exportImage.ts         export PNG via canvas
    effects.ts             confettis
    model.ts, constants.ts, utils.ts, router.svelte.ts, toast.svelte.ts
  components/
    Library.svelte         bibliothèque : créer, ouvrir, dupliquer, supprimer, importer ; onglet Communauté
    CommunityGrid.svelte   galerie des listes publiées
    CommunityView.svelte   liste publiée en lecture seule (faire ma version, signaler, retirer)
    EditorPage.svelte      chargement d'une liste depuis IndexedDB
    Editor.svelte          éditeur : en-tête, rangs, clavier, collage, dépôt de fichiers
    Row, Zone, Tile, Dock, Swatches, Modal, Icon, Logo
    modals/                rang, vignette, partage, export, nouvelle liste, import, catalogues (dont l'onglet musique)
```

## Stockage

- `lists` : la structure de chaque liste (titre, rangs, ordre des vignettes). Léger, c'est ce que lit la bibliothèque.
- `items` : les vignettes, indexées par `listId`. Les images sont des `Blob` (pas de base64), réduites à 320 px.
- Les vignettes sont immuables : modifier une vignette en crée une nouvelle, ce qui rend l'annulation simple.
  Les vignettes orphelines sont nettoyées à l'ouverture de la liste.
- Pour faire évoluer le schéma, ajouter `this.version(2)` dans `db.ts` sans modifier la version 1.

`MainList_v1.html` est le prototype d'origine, gardé comme référence.
