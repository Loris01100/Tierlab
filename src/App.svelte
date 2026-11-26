<script lang="ts">
  import CommunityView from './components/CommunityView.svelte';
  import EditorPage from './components/EditorPage.svelte';
  import Library from './components/Library.svelte';
  import LiveJoin from './components/LiveJoin.svelte';
  import { PUB_RE } from '../shared/community';
  import { ROOM_RE } from '../shared/live';
  import { COMMUNITY_PATH, route } from './lib/router.svelte';
  import { toastState } from './lib/toast.svelte';

  const listId = $derived(route.path.match(/^\/list\/([\w-]+)$/)?.[1] ?? null);
  const room = $derived(route.path.match(/^\/live\/([^/]+)$/)?.[1] ?? null);
  const pub = $derived(route.path.match(/^\/community\/([^/]+)$/)?.[1] ?? null);
</script>

{#if room && ROOM_RE.test(room)}
  {#key room}
    <LiveJoin {room} />
  {/key}
{:else if listId}
  {#key listId}
    <EditorPage id={listId} />
  {/key}
{:else if pub && PUB_RE.test(pub)}
  {#key pub}
    <CommunityView id={pub} />
  {/key}
{:else}
  <Library tab={route.path === COMMUNITY_PATH ? 'community' : 'mine'} />
{/if}

<div class="toast" class:on={toastState.on} role="status" aria-live="polite">{toastState.msg}</div>
