<script lang="ts">
  import { untrack } from 'svelte';
  import { LIMITS, TILE_COLORS } from '../../lib/constants';
  import type { Editor } from '../../lib/editor.svelte';
  import { shrink } from '../../lib/images';
  import { toast } from '../../lib/toast.svelte';
  import type { ItemDraft } from '../../lib/types';
  import { fgFor } from '../../lib/utils';
  import Modal from '../Modal.svelte';
  import Swatches from '../Swatches.svelte';
  import Tile from '../Tile.svelte';

  let { ed, itemId, onclose, ondelete }: { ed: Editor; itemId: string; onclose: () => void; ondelete: () => void } = $props();

  // la fenêtre travaille sur une copie prise à l'ouverture
  const orig = untrack(() => ed.items[itemId]);
  let type = $state(orig.type);
  let text = $state(orig.text);
  let bg = $state(orig.bg ?? TILE_COLORS[0]);
  let blob = $state.raw(orig.blob);
  const draft = $derived<ItemDraft>({ type, text, bg, fg: fgFor(bg), blob });

  let input: HTMLInputElement;

  function final(): ItemDraft | null {
    const t = text.trim().slice(0, LIMITS.tileText);
    if (type === 'text' && !t) {
      input.focus();
      return null;
    }
    return { ...draft, text: t };
  }
  function save() {
    const d = final();
    if (!d) return;
    ed.replaceItem(itemId, d);
    onclose();
  }
  function dup() {
    const d = final();
    if (!d) return;
    ed.duplicateItem(itemId, d);
    onclose();
    toast('Vignette dupliquée');
  }
  async function pick(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    try {
      blob = await shrink(f);
      type = 'img';
    } catch {
      toast('Image illisible');
    }
  }
</script>

<Modal title="Modifier la vignette" {onclose}>
  <div class="preview"><Tile item={draft} /></div>
  <label for="eTxt">{orig.type === 'img' ? 'Texte sous l’image (facultatif)' : 'Texte'}</label>
  <input
    bind:this={input}
    type="text"
    id="eTxt"
    maxlength={LIMITS.tileText}
    bind:value={text}
    onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
  />
  {#if type === 'text'}
    <span class="lbl">Couleur de fond</span>
    <Swatches colors={TILE_COLORS} bind:value={bg} custom label="Couleur de fond" />
  {/if}
  <label for="eFile">{type === 'img' ? 'Remplacer l’image' : 'Ajouter une image (le texte passe sous l’image)'}</label>
  <input type="file" id="eFile" accept="image/*" onchange={pick} />
  <div class="foot">
    <button class="btn danger l" onclick={ondelete}>Supprimer</button>
    <button class="btn" onclick={dup}>Dupliquer</button>
    <button class="btn" onclick={onclose}>Annuler</button>
    <button class="btn pri" onclick={save}>Enregistrer</button>
  </div>
</Modal>
