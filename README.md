# Tierlab

Créateur de tier listes : Svelte 5 + TypeScript + IndexedDB (Dexie), construit avec Vite.

## Commandes

```bash
npm install      # dépendances
npm run dev      # serveur de dev sur http://localhost:5173
npm run check    # vérification des types (svelte-check)
npm run build    # build de production dans dist/
```

## Structure

```
src/
  main.ts, App.svelte      point d'entrée, routage #/ et #/list/<id>
  app.css                  feuille de style unique (reprise du prototype)
  lib/
    types.ts               Item, Tier, TierList
    db.ts                  schéma IndexedDB (tables lists et items) et accès
    editor.svelte.ts       état réactif d'une liste : actions, annulation, sauvegarde auto
    drag.ts                glisser-déposer souris et tactile (Pointer Events)
    images.ts              réduction des images en Blob WebP, URLs objet
    share.ts               code de partage JSON (compatible avec le prototype)
    exportImage.ts         export PNG via canvas
    effects.ts             confettis
    model.ts, constants.ts, utils.ts, router.svelte.ts, toast.svelte.ts
  components/
    Library.svelte         bibliothèque : créer, ouvrir, dupliquer, supprimer, importer
    EditorPage.svelte      chargement d'une liste depuis IndexedDB
    Editor.svelte          éditeur : en-tête, rangs, clavier, collage, dépôt de fichiers
    Row, Zone, Tile, Dock, Swatches, Modal, Icon
    modals/                rang, vignette, partage, export, nouvelle liste, import
```

## Stockage

- `lists` : la structure de chaque liste (titre, rangs, ordre des vignettes). Léger, c'est ce que lit la bibliothèque.
- `items` : les vignettes, indexées par `listId`. Les images sont des `Blob` (pas de base64), réduites à 320 px.
- Les vignettes sont immuables : modifier une vignette en crée une nouvelle, ce qui rend l'annulation simple.
  Les vignettes orphelines sont nettoyées à l'ouverture de la liste.
- Pour faire évoluer le schéma, ajouter `this.version(2)` dans `db.ts` sans modifier la version 1.

`MainList_v1.html` est le prototype d'origine, gardé comme référence.
