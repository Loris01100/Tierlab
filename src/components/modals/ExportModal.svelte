<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { toast } from '../../lib/toast.svelte';
  import Modal from '../Modal.svelte';

  let { blob, filename, onclose }: { blob: Blob; filename: string; onclose: () => void } = $props();

  const url = untrack(() => URL.createObjectURL(blob));
  onDestroy(() => URL.revokeObjectURL(url));

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Image copiée');
    } catch {
      toast('Copie indisponible : utilisez « Télécharger »');
    }
  }
</script>

<Modal title="Image prête" {onclose}>
  <div class="exp"><img src={url} alt="Tier liste exportée" /></div>
  <div class="foot">
    <button class="btn" onclick={copy}>Copier l’image</button>
    <button class="btn" onclick={onclose}>Fermer</button>
    <a class="btn pri" href={url} download={filename}>Télécharger</a>
  </div>
</Modal>
