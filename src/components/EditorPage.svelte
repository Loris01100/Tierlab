<script lang="ts">
  import { onDestroy } from 'svelte';
  import { loadList, pruneItems } from '../lib/db';
  import { Editor } from '../lib/editor.svelte';
  import { releaseUrls } from '../lib/images';
  import { go } from '../lib/router.svelte';
  import EditorView from './Editor.svelte';

  let { id }: { id: string } = $props();

  // Chargement depuis IndexedDB ; les vignettes orphelines (supprimées lors d'une session précédente) sont nettoyées.
  const load = (async () => {
    const data = await loadList(id);
    if (!data) return null;
    const ed = new Editor(data.list, data.items);
    void pruneItems(id, new Set(ed.usedIds()));
    return ed;
  })();

  onDestroy(() => {
    void load.then((ed) => ed?.live?.close());
    releaseUrls();
  });
</script>

{#await load}
  <p class="loading">Chargement…</p>
{:then ed}
  {#if ed}
    <EditorView {ed} />
  {:else}
    <div class="missing">
      <p>Cette tier liste n’existe pas ou a été supprimée.</p>
      <button class="btn pri" onclick={() => go('/')}>Retour à mes listes</button>
    </div>
  {/if}
{:catch}
  <div class="missing"><p>Impossible d’ouvrir le stockage local (navigation privée ou stockage bloqué ?).</p></div>
{/await}
