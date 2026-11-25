<script lang="ts">
  import { flip } from 'svelte/animate';
  import type { Editor } from '../lib/editor.svelte';
  import Tile from './Tile.svelte';

  let {
    ed,
    zone,
    ids,
    class: cls = '',
    label,
    empty = '',
  }: { ed: Editor; zone: string; ids: string[]; class?: string; label?: string; empty?: string } = $props();

  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
</script>

<div class="zone {cls}" class:over={ed.overZone === zone} data-zone={zone} aria-label={label}>
  {#each ids.filter((id) => ed.items[id]) as id (id)}
    <div class="slot" animate:flip={{ duration: dur }}>
      <Tile item={ed.items[id]} {id} selected={ed.selId === id} dragging={ed.dragId === id} />
    </div>
  {/each}
  {#if empty && !ids.length}
    <p class="empty">{empty}</p>
  {/if}
</div>
