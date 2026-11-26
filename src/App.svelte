<script lang="ts">
  import EditorPage from './components/EditorPage.svelte';
  import Library from './components/Library.svelte';
  import LiveJoin from './components/LiveJoin.svelte';
  import { ROOM_RE } from '../shared/live';
  import { route } from './lib/router.svelte';
  import { toastState } from './lib/toast.svelte';

  const listId = $derived(route.path.match(/^\/list\/([\w-]+)$/)?.[1] ?? null);
  const room = $derived(route.path.match(/^\/live\/([^/]+)$/)?.[1] ?? null);
</script>

{#if room && ROOM_RE.test(room)}
  {#key room}
    <LiveJoin {room} />
  {/key}
{:else if listId}
  {#key listId}
    <EditorPage id={listId} />
  {/key}
{:else}
  <Library />
{/if}

<div class="toast" class:on={toastState.on} role="status" aria-live="polite">{toastState.msg}</div>
