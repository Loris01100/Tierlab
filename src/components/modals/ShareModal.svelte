<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from '../../lib/editor.svelte';
  import { toShared } from '../../lib/share';
  import { toast } from '../../lib/toast.svelte';
  import Modal from '../Modal.svelte';

  let { ed, onclose }: { ed: Editor; onclose: () => void } = $props();

  let code = $state('');
  let out: HTMLTextAreaElement;

  onMount(async () => {
    code = JSON.stringify(await toShared({ title: ed.title, tiers: ed.tiers, pool: ed.pool, items: ed.items }));
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copié');
    } catch {
      out.focus();
      out.select();
      toast('Code sélectionné : faites Ctrl+C');
    }
  }
</script>

<Modal title="Partager" {onclose}>
  <label for="shOut">Code de cette tier liste, à copier et envoyer</label>
  <textarea bind:this={out} id="shOut" readonly value={code || 'Préparation…'}></textarea>
  <p class="small">Pour ouvrir un code reçu : bibliothèque, puis « Importer un code ».</p>
  <div class="foot">
    <button class="btn" onclick={onclose}>Fermer</button>
    <button class="btn pri" disabled={!code} onclick={copy}>Copier le code</button>
  </div>
</Modal>
