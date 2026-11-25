---
name: dexie-storage
description: Règles de stockage IndexedDB/Dexie de Tierlab (src/lib/db.ts, types.ts, share.ts, images.ts). À charger avant de toucher au schéma, aux lectures/écritures en base, aux images Blob, à la sauvegarde de l'Editor ou au format d'échange SharedData.
---

# Stockage local (Dexie 4 / IndexedDB)

Tout l'accès à la base passe par `src/lib/db.ts`. Les composants n'importent pas `db` directement : ajouter une fonction nommée dans `db.ts` (comme `loadList`, `saveList`, `pruneItems`) et l'appeler.

## Modèle de données
- `lists` : structure seule (`TierList` : titre, rangs, ordre des ids, pool). Léger, lu par la bibliothèque — ne jamais y mettre d'images ni de données lourdes.
- `items` : vignettes (`Item`), indexées par `listId`. Images en `Blob` (WebP 320 px via `shrink()` de `images.ts`), **jamais** en base64 dans la base.
- **Items immuables** : modifier une vignette = créer un nouvel `Item` avec un nouvel `uid()` et remplacer l'id dans la structure. Ne jamais faire `db.items.update(...)` sur une vignette existante : cela casserait l'annulation. Les orphelins sont supprimés par `pruneItems` à l'ouverture.

## Écritures
- Écritures sur plusieurs tables → une seule `db.transaction('rw', db.lists, db.items, async () => { … })`. Dans la transaction, n'`await` que des opérations Dexie (pas de `fetch`, `setTimeout`, ni `shrink()` : la transaction se fermerait). Préparer les Blobs **avant**.
- Lots : `bulkPut` / `bulkDelete` plutôt qu'une boucle de `put`.
- Les objets écrits doivent être clonables : passer les états Svelte par `$state.snapshot()` (voir `Editor.flush()`). Un proxy `$state` provoque une `DataCloneError`.
- Pendant l'édition, ne pas écrire directement : les méthodes de `Editor` appellent `touch()` (sauvegarde différée 400 ms, sérialisée dans `#saving`). Pour un item nouveau, l'ajouter à `#dirty` afin que `flush()` l'enregistre.
- Gérer l'échec (quota, navigation privée) par un `toast(...)` en français, sans perdre l'état en mémoire.

## Lectures
- Utiliser les index déclarés (`where('listId').equals(id)`, `orderBy('updatedAt')`). Pour filtrer sur un champ non indexé, soit `filter()` après un `where` indexé, soit ajouter un index via une nouvelle version du schéma.
- La bibliothèque ne charge que `lists` ; les `items` ne sont lus qu'à l'ouverture d'une liste.

## Évolution du schéma
- **Ne jamais modifier `this.version(1)`**. Ajouter à la suite :
  ```ts
  this.version(2)
    .stores({ lists: 'id, updatedAt, nouvelIndex', items: 'id, listId' })
    .upgrade((tx) => tx.table('lists').toCollection().modify((l) => { l.nouveauChamp ??= valeurParDefaut; }));
  ```
- Ne lister dans `stores` que les champs indexés (la clé primaire en premier) ; les autres champs n'ont pas à y figurer.
- Mettre à jour les interfaces de `types.ts` en même temps, avec des champs optionnels si d'anciennes données peuvent ne pas les avoir.

## URLs d'images
- Afficher un Blob via `blobUrl(blob)` (cache une URL par Blob) ; elles sont libérées par `releaseUrls()` à la fermeture de l'éditeur. Toute URL créée hors de ce cache doit être révoquée (`URL.revokeObjectURL`) dans `onDestroy`.

## Format d'échange (`share.ts`)
- `SharedData` (`v: 1`) doit rester compatible avec le prototype `MainList_v1.html` : ne pas renommer ni retirer de champ, images en data URL base64 (conversion Blob ↔ data URL uniquement à l'export/import).
- À l'import, considérer les données comme non fiables : valider les types, couleurs (`isColor`), longueurs (`LIMITS`), nombre d'images, et ignorer ce qui est invalide plutôt que de planter.
- Un changement incompatible exigerait `v: 2` avec lecture continue de `v: 1`.

## Vérification
`npm run check`, puis tester dans le navigateur : créer, modifier, annuler, recharger la page (les données doivent persister), et import/export d'un code de partage.
