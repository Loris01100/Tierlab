<script lang="ts">
  import { blobUrl } from '../lib/images';
  import type { ItemDraft } from '../lib/types';

  let {
    item,
    id,
    selected = false,
    dragging = false,
  }: {
    item: ItemDraft;
    /** Absent pour un aperçu (fenêtre d'édition) : la vignette n'est alors ni focusable ni déplaçable. */
    id?: string;
    selected?: boolean;
    dragging?: boolean;
  } = $props();

  const src = $derived(item.type === 'img' ? blobUrl(item.blob) : '');
  const label = $derived(item.text || (item.type === 'img' ? (item.blob ? 'Image' : 'Image en cours de chargement') : ''));
</script>

{#if item.type === 'img'}
  <div
    class="tile"
    class:capt={!!item.text}
    class:wait={!item.blob}
    class:sel={selected}
    class:drag={dragging}
    data-id={id}
    tabindex={id ? 0 : -1}
    role="button"
    aria-label={label}
    aria-pressed={id ? selected : undefined}
  >
    {#if item.text}
      <span class="pic"><img {src} alt="" draggable="false" /></span>
      <span class="cap">{item.text}</span>
    {:else}
      <img {src} alt="" draggable="false" />
    {/if}
  </div>
{:else}
  <div
    class="tile"
    class:sel={selected}
    class:drag={dragging}
    data-id={id}
    tabindex={id ? 0 : -1}
    role="button"
    aria-pressed={id ? selected : undefined}
    style:background={item.bg}
    style:color={item.fg}
  >
    {item.text}
  </div>
{/if}
