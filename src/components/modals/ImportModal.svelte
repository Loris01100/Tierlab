<script lang="ts">
  import { toast } from '../../lib/toast.svelte';
  import Modal from '../Modal.svelte';

  let { onclose, onimport }: { onclose: () => void; onimport: (code: string) => Promise<boolean> } = $props();

  let code = $state('');
  let busy = $state(false);

  async function submit() {
    busy = true;
    const ok = await onimport(code);
    busy = false;
    if (!ok) toast('Code invalide');
  }
</script>

<Modal title="Importer un code" {onclose}>
  <label for="imIn">Collez le code reçu : une nouvelle liste sera créée.</label>
  <textarea id="imIn" bind:value={code} placeholder="Collez le code ici"></textarea>
  <div class="foot">
    <button class="btn" onclick={onclose}>Annuler</button>
    <button class="btn pri" disabled={!code.trim() || busy} onclick={submit}>Ouvrir ce code</button>
  </div>
</Modal>
