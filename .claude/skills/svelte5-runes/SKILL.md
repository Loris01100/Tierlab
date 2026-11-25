---
name: svelte5-runes
description: Règles Svelte 5 (runes) pour Tierlab. À charger avant de créer ou modifier un composant .svelte ou un fichier .svelte.ts (état réactif, props, effets, snippets, événements, classe Editor, stores globaux).
---

# Svelte 5 (runes) dans Tierlab

Le projet est 100 % runes : aucune syntaxe Svelte 4 (`export let`, `$:`, `on:click`, `<slot>`, `createEventDispatcher`, stores `writable`). Ne jamais en réintroduire.

## Props
- Une seule déclaration `$props()` déstructurée avec son type en ligne, comme dans `Row.svelte` / `Tile.svelte` :
  ```ts
  let { ed, tier, onconfig }: { ed: Editor; tier: Tier; onconfig: (id: string) => void } = $props();
  ```
- Valeurs par défaut dans la déstructuration (`selected = false`). Documenter les props non évidentes par un commentaire `/** … */` en français.
- Liaison bidirectionnelle seulement si nécessaire : `value = $bindable()` (modèle : `Swatches.svelte`). Sinon préférer un callback `onchange`.
- Ne jamais muter une prop reçue (sauf `$bindable`). Pour l'état de la liste, passer par les méthodes de `Editor`.

## Événements et contenu
- Événements DOM en attributs : `onclick={…}`, `onpointerdown={…}`. Événements de composant = props callback nommées `onxxx` (`onclose`, `onconfig`).
- Contenu enfant : `children: Snippet` + `{@render children()}` (modèle : `Modal.svelte`). Snippets nommés avec `{#snippet nom(args)}`.
- Comportement attaché à un élément : `{@attach fn}` (modèle : `autofocus` dans `Modal.svelte`), pas `use:action`. La fonction peut retourner un nettoyage.
- Fenêtre / document : `<svelte:window onkeydown={…} />` plutôt que `addEventListener` manuel dans un composant.

## État
- `$state` pour l'état local mutable. Les objets/tableaux deviennent des proxies profonds : `push`, `splice`, affectation de propriété sont réactifs.
- `$state.raw` pour les données volumineuses ou immuables qu'on remplace en bloc (ex. `Editor.items`, l'historique, un `Blob`). On ne les mute pas : on réaffecte (`this.items = { ...this.items, [id]: item }`).
- **Avant de sortir un état du monde réactif** (IndexedDB, `structuredClone`, `postMessage`, `JSON` pour comparaison stable) : `$state.snapshot(x)`. Un proxy `$state` passé à Dexie provoque une `DataCloneError`. Modèle : `Editor.flush()`.
- État global partagé : fichier `*.svelte.ts` qui exporte un **objet** `$state` dont on mute les propriétés (`route`, `toastState`). On ne peut pas réaffecter une variable `$state` exportée.
- Classes réactives : champs `x = $state(…)` et `y = $derived(…)` directement dans la classe ; champs privés `#x` pour l'interne (modèle : `Editor`).

## Dérivés et effets
- Valeur calculée → `$derived(expr)` ou `$derived.by(() => { … })`. **Jamais** un `$effect` qui écrit dans un `$state` pour calculer une valeur.
- `$effect` uniquement pour synchroniser avec l'extérieur (DOM impératif, timers, `AbortController`, API navigateur). Retourner une fonction de nettoyage si l'effet crée quelque chose (timer, requête, écouteur).
- Seules les lectures **synchrones** sont suivies : ce qui est lu après un `await` dans un effet n'est pas une dépendance. Lire les dépendances en tête de l'effet (modèle : `Row.svelte` lit `tier.name` d'abord).
- Requête déclenchée par une saisie : dans l'effet, créer un `AbortController`, passer `signal` à `apiGet`, et `return () => ctrl.abort()`.
- Valeur initiale volontairement non réactive d'une prop (formulaire d'édition dans une modale) : `untrack(() => …)` (modèle : `TileModal.svelte`, `RowModal.svelte`).
- `onMount` reste acceptable pour un chargement unique ; `onDestroy` pour libérer (`releaseUrls`, `URL.revokeObjectURL`).
- `$inspect` est réservé au débogage : ne pas le laisser dans le code.

## Template
- `{#each}` toujours avec clé : `{#each ed.tiers as tier, i (tier.id)}`.
- Classes / styles conditionnels : `class:sel={selected}`, `style:--c={tier.color}`, `style:background={…}`.
- Chargement async : `{#await promesse}{:then v}{:catch}` (modèle : `EditorPage.svelte`), avec un message d'erreur en français.
- Accessibilité : `svelte-check` signale les problèmes a11y ; les corriger (`role`, `aria-label` en français, `tabindex`) plutôt que de les masquer avec `svelte-ignore`.

## Style
- Pas de `<style>` par composant : tout le CSS est dans `src/app.css` (feuille globale unique). Réutiliser les classes existantes (`btn`, `pri`, `ib`, `modal`, `card`…) avant d'en créer.

## Vérification
`npm run check` doit passer sans erreur ni avertissement avant de considérer la tâche terminée.
