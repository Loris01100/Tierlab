---
name: ui-design
description: Règles de design visuel de Tierlab (src/app.css, couleurs, typo Rubik, boutons, vignettes, modales, animations, mobile, thème clair/sombre, icônes). À charger avant de toucher au style, d'ajouter un composant visible, une modale, un bouton, une icône ou une animation.
---

# Design de Tierlab

## Intention (en tête de `src/app.css`)
- **Voix** : outil du quotidien, rapide et joueur, mais net.
- **Idée** : la tier list classique — bandeaux d'étiquettes colorés, étagères grises, un plateau de vignettes en dessous (le dock).
- **Couleur** : fond neutre, pastels de tier du rouge au bleu, bleu électrique (`--acc`) réservé aux actions.
- **Typo** : Rubik 800 pour titres et noms de tier, Rubik 400–600 pour le reste.

Toute nouveauté doit tenir dans cette intention : pas de nouvelle police, pas de nouvelle couleur d'accent, pas de style « tableau de bord ».

## Où mettre le CSS
- **Une seule feuille globale** : `src/app.css`. Pas de bloc `<style>` dans les composants (aucun n'en a), pas de CSS inline sauf variables (`style:--c={couleur}`, `style:--i={index}`, `style:--w`).
- Ranger les règles dans la section commentée correspondante (`/* ---------- dock ---------- */`, etc.) ; créer une section si besoin, commentaire en français.
- Classes courtes et en minuscules, dans le style existant (`.btn`, `.ib`, `.lab`, `.zone`, `.lcard`). États via `class:xxx={…}` (`.over`, `.sel`, `.drag`, `.on`).
- Une règle par ligne, propriétés à la suite (format actuel du fichier). Garder le fichier compact.

## Jetons (`:root`)
| Jeton | Rôle |
|---|---|
| `--bg` | fond de page, fond des cartes de modale |
| `--ink` | texte principal |
| `--mute` | texte secondaire, icônes au repos, bordure au survol |
| `--panel` | surfaces surélevées (boutons, dock, cartes de liste) |
| `--zone` | étagères des tiers, fonds en creux |
| `--line` | bordures, séparateurs du plateau |
| `--acc` | **actions uniquement** : bouton principal, focus, zone survolée en drag |
| `--danger` | suppression, corbeille, erreurs |
| `--t` | taille d'une vignette (réglée par le curseur de taille) |

- Toujours utiliser ces jetons, jamais une couleur en dur pour une surface ou du texte. Les jetons sont en `light-dark(clair, sombre)` : une nouvelle couleur de surface doit aussi l'être.
- Le thème suit le système ; `data-theme="light|dark"` sur `<html>` force `color-scheme`. Vérifier toute modif dans les deux thèmes.
- Teintes dérivées : `color-mix(in srgb, var(--acc) 16%, var(--zone))` plutôt qu'une nouvelle couleur.
- Texte sur une couleur de tier (`.lab`, `.chips i`) : toujours `#17181c` (les pastels sont clairs dans les deux thèmes).
- Palettes de données dans `src/lib/constants.ts` : `TIER_COLORS` (bandeaux), `PALETTE` (choix de tier), `TILE_COLORS` (vignettes texte), `PARTY` (confettis). Ajouter une couleur là, pas dans le CSS.

## Composants existants à réutiliser
- **Boutons** : `.btn` (44 px de haut, rayon 10 px) ; variantes `.pri` (dégradé accent), `.danger` (texte rouge), `.pri.danger-bg` (confirmation destructive), `.sm` (32 px). Bouton icône : `.ib` (40×34, transparent). Icône + libellé : `<Icon name="…" /><span>Texte</span>` — le `<span>` est masqué sur mobile dans `.acts`.
- **Icônes** : `Icon.svelte`, tracés 24×24 en trait (`stroke-width 2`, style Lucide). Ajouter un tracé dans `PATHS`, jamais d'image ni de police d'icônes.
- **Modales** : `Modal.svelte` → `.modal` + `.card` (540 px max, rayon 16). Titre `h2`, champs `label` + `input[type=text]`, pied `.foot` (boutons à droite, `.l` pour pousser un bouton à gauche). Texte d'aide : `.small` (`.small.err` en erreur).
- **Listes de choix** : `.preset` (radio en carte), `.chk` (cases), `.mlist` / `.mrow-b` (ligne avec image 44 px + `.mtxt`).
- **Couleurs** : `Swatches.svelte` (`.sw`), pastilles rondes de 32 px.
- **Notifications** : toast global (`toast.svelte.ts`), pas d'alerte bloquante.

## Échelle
- Rayons : 4–6 px (petits éléments, vignettes), 8–10 px (boutons, champs), 12–16 px (plateau, cartes, dock, modales).
- Espacements usuels : 4, 8, 10, 12, 14, 16, 20 px. Marge latérale : `max(3vw, 16px)`. Largeur max du contenu : 1240 px.
- Tailles de texte : 13 px (aide, méta), 14–15 px (UI), 16 px (corps et **tous les champs**, évite le zoom iOS), 17–22 px (titres de carte), `clamp(24px, 3.4vw, 38px)` (grand titre).
- Titres : `font: 800 …/1.1 Rubik` + `letter-spacing: -0.02em` pour les plus grands.

## Mouvement
Le côté « joueur » passe par des animations à rebond, courtes :
- Courbe signature : `cubic-bezier(0.3, 1.8, 0.5, 1)` (survol, corbeille) ou `cubic-bezier(0.2, 1.4…1.7, 0.4, 1)` (entrées). Durées 0,15–0,5 s.
- Survol bouton : `translateY(-2px)`, clic : `scale(0.93)`. Effets de survol des vignettes sous `@media (hover: hover)` et jamais pendant un drag (`body:not(.dragging)`).
- Entrées en cascade avec `animation-delay: calc(var(--i) * 70ms)`.
- `@keyframes` nommés court en camelCase, regroupés dans la section animations.
- `prefers-reduced-motion: reduce` coupe tout globalement : ne rien rendre indispensable par l'animation seule.

## Accessibilité et interaction
- Cibles tactiles ≥ 44 px pour les actions principales (32 px minimum pour les secondaires).
- Focus visible : `outline: 3px solid var(--acc); outline-offset: 2px` — ajouter le sélecteur à la règle `:focus-visible` commune.
- Chaque bouton icône a un `aria-label` ou un `title` en français ; les zones de drop ont un `aria-label`.
- Le drag-and-drop doit garder son alternative clavier (Espace/Entrée pour sélectionner, chiffres pour placer, Suppr, voir `onkeydown` dans `Editor.svelte`).

## Mobile (≤ 600 px)
- Libellés des boutons d'en-tête masqués (icône seule), dock non collant, aide masquée. Ajouter les ajustements dans le bloc `@media (max-width: 600px)` existant.
- Pas de défilement horizontal de page (`overflow-x: clip` sur `body`, `min-width: 0` global) : utiliser `flex-wrap` et `minmax(0, 1fr)`.

## Vérification
1. `npm run check`.
2. Lancer le site (`npm run dev`, http://localhost:5173) et regarder la bibliothèque **et** l'éditeur, en thème clair et sombre, à ~375 px et en bureau.
