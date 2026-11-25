<script lang="ts">
  import { untrack } from 'svelte';
  import { LIMITS, PALETTE } from '../../lib/constants';
  import type { Editor } from '../../lib/editor.svelte';
  import { toast } from '../../lib/toast.svelte';
  import Modal from '../Modal.svelte';
  import Swatches from '../Swatches.svelte';

  let { ed, tierId, onclose, onadded }: { ed: Editor; tierId: string; onclose: () => void; onadded: (id: string) => void } = $props();

  const tier = untrack(() => ed.tiers.find((t) => t.id === tierId)!);
  let name = $state(tier.name);
  let color = $state(tier.color);

  function save() {
    ed.updateTier(tierId, name, color);
    onclose();
  }
  function insert(offset: 0 | 1) {
    const id = ed.addTier(ed.tiers.findIndex((t) => t.id === tierId) + offset);
    onclose();
    onadded(id);
  }
</script>

<Modal title="Modifier le rang" {onclose}>
  <label for="rName">Nom</label>
  <input type="text" id="rName" maxlength={LIMITS.tierName} bind:value={name} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), save())} />
  <span class="lbl">Couleur</span>
  <Swatches colors={PALETTE} bind:value={color} custom label="Couleur du rang" />
  <div class="foot start">
    <button class="btn" onclick={() => insert(0)}>Insérer au-dessus</button>
    <button class="btn" onclick={() => insert(1)}>Insérer en dessous</button>
    <button class="btn" onclick={() => (ed.clearTier(tierId), onclose())}>Vider vers la réserve</button>
    <button
      class="btn danger"
      onclick={() => {
        ed.deleteTier(tierId);
        onclose();
        toast('Rang supprimé, vignettes remises en réserve');
      }}>Supprimer le rang</button
    >
  </div>
  <div class="foot">
    <button class="btn" onclick={onclose}>Annuler</button>
    <button class="btn pri" onclick={save}>Enregistrer</button>
  </div>
</Modal>
