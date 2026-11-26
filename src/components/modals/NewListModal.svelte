<script lang="ts">
  import { LIMITS, PRESETS } from '../../lib/constants';
  import { makeTiers } from '../../lib/model';
  import Modal from '../Modal.svelte';

  let { onclose, oncreate }: { onclose: () => void; oncreate: (title: string, tiers: string[]) => void } = $props();

  let title = $state('Ma tier liste');
  let preset = $state('classic');

  const submit = () => oncreate(title.trim() || 'Ma tier liste', PRESETS[preset].tiers);
</script>

<Modal title="Nouvelle tier liste" {onclose}>
  <label for="nTitle">Titre</label>
  <input type="text" id="nTitle" maxlength={LIMITS.title} bind:value={title} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())} />
  <span class="lbl">Rangs</span>
  {#each Object.entries(PRESETS) as [key, p] (key)}
    <label class="preset">
      <input type="radio" name="preset" value={key} bind:group={preset} />
      <span class="chips">
        {#each makeTiers(p.tiers) as t (t.id)}<i style:--c={t.color}>{t.name}</i>{/each}
      </span>
      <span>{p.name}</span>
    </label>
  {/each}
  <div class="foot">
    <button class="btn" onclick={onclose}>Annuler</button>
    <button class="btn pri" onclick={submit}>Créer</button>
  </div>
</Modal>
