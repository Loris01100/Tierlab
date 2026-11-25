<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  // Focus sur le premier champ utile à l'ouverture ; Échap ferme.
  function autofocus(card: HTMLElement) {
    const f = card.querySelector<HTMLElement>('input[type=text],textarea,.pri');
    f?.focus();
    if (f instanceof HTMLInputElement) f.select();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (e.preventDefault(), onclose())} />

<div class="modal" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="card" role="dialog" aria-modal="true" aria-label={title} {@attach autofocus}>
    <h2>{title}</h2>
    {@render children()}
  </div>
</div>
