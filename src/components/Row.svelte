<script lang="ts">
  import { LIMITS } from '../lib/constants';
  import type { Editor } from '../lib/editor.svelte';
  import type { Tier } from '../lib/types';
  import Icon from './Icon.svelte';
  import Zone from './Zone.svelte';

  let { ed, tier, index, onconfig }: { ed: Editor; tier: Tier; index: number; onconfig: (id: string) => void } = $props();

  let lab: HTMLDivElement;

  // Le nom n'est réécrit que hors saisie, pour ne pas déplacer le curseur.
  $effect(() => {
    const name = tier.name;
    if (lab && document.activeElement !== lab) lab.textContent = name;
  });

  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, LIMITS.tierName);
</script>

<div class="row" data-row={tier.id} style:--i={index}>
  <div
    bind:this={lab}
    class="lab"
    style:--c={tier.color}
    contenteditable="true"
    spellcheck="false"
    role="textbox"
    tabindex="0"
    aria-label="Nom du rang {index + 1}"
    data-t={tier.id}
    onfocus={() => ed.beginEdit()}
    oninput={() => ed.renameTierLive(tier.id, clean(lab.textContent ?? ''))}
    onblur={() => {
      if (!tier.name) ed.renameTierLive(tier.id, '?');
      lab.textContent = tier.name;
      ed.endEdit();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lab.blur();
      }
    }}
  ></div>
  <Zone {ed} zone={tier.id} ids={tier.items} />
  <div class="ctl">
    <button class="ib mv" aria-label="Monter le rang" disabled={index === 0} onclick={() => ed.moveTier(index, -1)}>
      <Icon name="up" />
    </button>
    <button class="ib" aria-label="Options du rang" onclick={() => onconfig(tier.id)}><Icon name="edit" /></button>
    <button class="ib mv" aria-label="Descendre le rang" disabled={index === ed.tiers.length - 1} onclick={() => ed.moveTier(index, 1)}>
      <Icon name="down" />
    </button>
  </div>
</div>
