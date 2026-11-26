<script lang="ts">
  import { expandHex } from '../lib/utils';

  let {
    colors,
    value = $bindable(),
    mix = false,
    custom = false,
    label = 'Couleur',
  }: { colors: string[]; value: string; mix?: boolean; custom?: boolean; label?: string } = $props();
</script>

<div class="sw" role="group" aria-label={label}>
  {#if mix}
    <button type="button" class="mix" aria-label="Couleurs variées" aria-pressed={value === 'mix'} onclick={() => (value = 'mix')}></button>
  {/if}
  {#each colors as c (c)}
    <button type="button" style:--c={c} aria-label="Couleur {c}" aria-pressed={value === c} onclick={() => (value = c)}></button>
  {/each}
  {#if custom}
    <input type="color" aria-label="Couleur personnalisée" value={value === 'mix' ? '#3d5afe' : expandHex(value)} oninput={(e) => (value = e.currentTarget.value)} />
  {/if}
</div>
