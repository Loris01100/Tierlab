<script lang="ts">
  import EditorPage from './components/EditorPage.svelte';
  import Library from './components/Library.svelte';
  import { route } from './lib/router.svelte';
  import { toastState } from './lib/toast.svelte';

  const listId = $derived(route.path.match(/^\/list\/([\w-]+)$/)?.[1] ?? null);
</script>

{#if listId}
  {#key listId}
    <EditorPage id={listId} />
  {/key}
{:else}
  <Library />
{/if}

<div class="toast" class:on={toastState.on} role="status" aria-live="polite">{toastState.msg}</div>
