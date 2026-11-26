---
name: typescript-conventions
description: Conventions TypeScript et de code de Tierlab (strict, deux tsconfig, imports de types, langue, organisation de src/lib). À charger avant d'écrire ou de relire du code TypeScript dans src/, shared/ ou server/, et avant de terminer une tâche de code.
---

# Conventions TypeScript et code

## Deux projets TypeScript
- `tsconfig.json` : navigateur (`src/`, `shared/`), libs DOM.
- `tsconfig.node.json` : `server/` + `vite.config.ts`, types Node, **sans DOM**.
- `shared/` est compilé par les deux : aucune API DOM ni Node, aucune dépendance runtime — uniquement des types et, au besoin, des fonctions pures.
- `server/` ne doit jamais importer depuis `src/`, ni `src/` depuis `server/`. Le seul pont est `shared/`.

## Règles du compilateur (`strict`, `verbatimModuleSyntax`, `isolatedModules`)
- Imports de types explicites : `import type { Item } from './types'` ou `import { HttpError, type Route } from './api'`. Un import de type sans `type` casse la compilation.
- Pas d'`enum` ni de `namespace` : utiliser des unions de littéraux (`'text' | 'img'`) et des objets `as const` (cf. `LIMITS`).
- Pas de `any`. Pour une donnée externe (JSON, import, réponse d'API) : `unknown` puis vérification, ou une interface décrivant **les champs utilisés** suivie d'une assertion localisée.
- `!` (non-null) seulement quand l'invariant est évident à la ligne même (ex. `getContext('2d')!`) ; sinon tester et gérer le cas.
- Préférer `satisfies` à une assertion `as` quand on veut vérifier une forme sans perdre le type inféré (cf. `snapshot()` dans `editor.svelte.ts`).
- `readonly` pour les champs qui ne changent pas ; champs privés natifs `#x` plutôt que `private x`.
- Fonctions exportées : type de retour explicite (`: Promise<void>`, `: string`) comme dans `db.ts` / `api.ts`.

## Organisation
- Types métier dans `src/lib/types.ts`, constantes et limites dans `src/lib/constants.ts` (`LIMITS`, palettes), utilitaires purs dans `src/lib/utils.ts` (`uid`, `fgFor`, `isColor`). Réutiliser avant de recréer.
- Toute borne (longueur de texte, nombre de rangs, d'images…) passe par `LIMITS`, pas par un nombre magique.
- Fichier contenant des runes → extension `.svelte.ts` (`editor.svelte.ts`, `router.svelte.ts`, `toast.svelte.ts`). Sinon `.ts`.
- Aucune nouvelle dépendance npm sans nécessité réelle : le projet est volontairement minimal (seule dépendance runtime : `dexie`). Le glisser-déposer, le routage, les toasts sont faits maison.

## Async et erreurs
- Toujours gérer le rejet d'une promesse : `await` dans un `try/catch`, `.catch(...)`, ou `void promesse` **uniquement** si l'échec est volontairement ignoré (cf. `void pruneItems(...)`).
- Ignorer les `AbortError` (requêtes annulées) ; afficher les autres échecs à l'utilisateur avec `toast()` en français.
- Messages d'erreur visibles : en français, courts, actionnables (« Serveur injoignable », « Sauvegarde impossible (stockage plein ou bloqué) »).

## Langue et style
- Commentaires, chaînes d'UI, messages d'erreur, `aria-label` : **en français**, avec la typographie française (apostrophe `’`, `…`, guillemets « »).
- Identifiants (variables, fonctions, types) en anglais, courts, comme dans le code existant.
- Commentaires `/** … */` pour expliquer le **pourquoi** et les invariants, pas pour paraphraser le code.
- Formatage existant : 2 espaces, apostrophes simples, points-virgules, virgules finales, lignes jusqu'à ~140 caractères.

## Avant de déclarer une tâche terminée
1. `npm run check` sans erreur ni avertissement (il n'y a ni tests ni linter : c'est la seule vérification automatique).
2. Pour un changement visible, lancer `npm run dev` et vérifier le comportement dans le navigateur (souris **et** tactile si le glisser-déposer est concerné).
3. Si `CLAUDE.md` ou le README décrivent quelque chose que le changement modifie, les mettre à jour.
