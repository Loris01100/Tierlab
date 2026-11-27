<script lang="ts">
  import type { CommunityList } from '../../shared/community';
  import { ApiError } from '../lib/api';
  import { communityImageUrl, copyList, fetchCommunityList, ownerOf, reportList, unpublish } from '../lib/community.svelte';
  import { COMMUNITY_PATH, go, listPath } from '../lib/router.svelte';
  import { toast } from '../lib/toast.svelte';
  import { fgFor, plural, relativeTime } from '../lib/utils';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Modal from './Modal.svelte';

  /** Liste publiée dans la communauté, en lecture seule (#/community/<id>). */
  let { id }: { id: string } = $props();

  let data = $state<CommunityList | null>(null);
  let error = $state('');
  let busy = $state(false);
  let modal = $state<'report' | 'remove' | null>(null);

  const errorMessage = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

  $effect(() => {
    const ctrl = new AbortController();
    fetchCommunityList(id, ctrl.signal).then(
      (d) => (data = d),
      (e: unknown) => {
        if ((e as Error).name !== 'AbortError') error = errorMessage(e, 'Liste indisponible');
      },
    );
    return () => ctrl.abort();
  });

  const items = $derived(new Map((data?.board.items ?? []).map((i) => [i.id, i])));
  /** Liste locale d'origine, si elle a été publiée depuis cet appareil. */
  const own = $derived(ownerOf(id));

  async function copy() {
    if (!data) return;
    busy = true;
    try {
      const listId = await copyList(data);
      toast('Copie ajoutée à vos listes');
      go(listPath(listId));
    } catch (e) {
      toast(errorMessage(e, 'Copie impossible (stockage local plein ou bloqué ?)'));
    } finally {
      busy = false;
    }
  }

  async function sendReport() {
    modal = null;
    try {
      await reportList(id);
      toast('Merci, la liste a été signalée');
    } catch (e) {
      toast(errorMessage(e, 'Signalement impossible'));
    }
  }

  async function remove() {
    modal = null;
    if (!own) return;
    try {
      await unpublish(own);
      toast('Liste retirée de la communauté');
      go(COMMUNITY_PATH);
    } catch (e) {
      toast(errorMessage(e, 'Retrait impossible'));
    }
  }
</script>

{#snippet tile(itemId: string)}
  {@const it = items.get(itemId)}
  {#if it?.type === 'img'}
    <div class="tile" class:capt={!!it.text} role="img" aria-label={it.text || 'Image'}>
      {#if it.text}
        <span class="pic"><img src={communityImageUrl(id, it.id)} alt="" loading="lazy" /></span>
        <span class="cap">{it.text}</span>
      {:else}
        <img src={communityImageUrl(id, it.id)} alt="" loading="lazy" />
      {/if}
    </div>
  {:else if it}
    <div class="tile" style:background={it.bg} style:color={fgFor(it.bg ?? '#3d5afe')}>{it.text}</div>
  {/if}
{/snippet}

<header class="top">
  <button class="brand" onclick={() => go(COMMUNITY_PATH)} title="Communauté"><Logo /></button>
  <h1 class="vtitle">{data?.title ?? ''}</h1>
  <div class="acts">
    <button class="btn" aria-label="Communauté" onclick={() => go(COMMUNITY_PATH)}><Icon name="globe" /><span>Communauté</span></button>
    {#if data}
      {#if own}
        <button class="btn danger" aria-label="Retirer de la communauté" onclick={() => (modal = 'remove')}><Icon name="trash" /><span>Retirer</span></button>
      {:else}
        <button class="btn" aria-label="Signaler" onclick={() => (modal = 'report')}><Icon name="flag" /><span>Signaler</span></button>
      {/if}
      <button class="btn pri" aria-label="Faire ma version" disabled={busy} onclick={copy}><Icon name="copy" /><span>Faire ma version</span></button>
    {/if}
  </div>
</header>

{#if error}
  <div class="missing">
    <p>{error}</p>
    <button class="btn pri" onclick={() => go(COMMUNITY_PATH)}>Retour à la communauté</button>
  </div>
{:else if !data}
  <p class="loading">Chargement…</p>
{:else}
  <main class="view">
    <p class="vmeta">
      <span>par <b>{data.author || 'Anonyme'}</b></span>
      <span>{data.updated > data.created ? 'mise à jour' : 'publiée'} {relativeTime(data.updated)}</span>
      <span>{plural(data.tiles, 'vignette')}</span>
      {#if data.copies}<span>{plural(data.copies, 'copie')}</span>{/if}
    </p>
    <div class="board" aria-label="Tier liste">
      {#each data.board.tiers as t (t.id)}
        <div class="row">
          <div class="lab" style:--c={t.color}>{t.name}</div>
          <div class="zone">
            {#each t.items as itemId (itemId)}<div class="slot">{@render tile(itemId)}</div>{/each}
          </div>
        </div>
      {/each}
    </div>
    {#if data.board.pool.length}
      <h2 class="lib-h2 vpool">Non classées</h2>
      <div class="zone vzone">
        {#each data.board.pool as itemId (itemId)}<div class="slot">{@render tile(itemId)}</div>{/each}
      </div>
    {/if}
    <p class="small">« Faire ma version » copie cette liste dans vos listes : vous pourrez la reclasser à votre goût.</p>
  </main>
{/if}

{#if modal === 'report'}
  <Modal title="Signaler cette liste ?" onclose={() => (modal = null)}>
    <p>Pour un contenu choquant, illégal ou du spam. Une liste signalée par plusieurs personnes est masquée de la galerie.</p>
    <div class="foot">
      <button class="btn" onclick={() => (modal = null)}>Annuler</button>
      <button class="btn pri danger-bg" onclick={sendReport}>Signaler</button>
    </div>
  </Modal>
{:else if modal === 'remove'}
  <Modal title="Retirer de la communauté ?" onclose={() => (modal = null)}>
    <p>Seule la copie publiée disparaît de la galerie : votre liste locale, si vous l’avez gardée, n’est pas touchée.</p>
    <div class="foot">
      <button class="btn" onclick={() => (modal = null)}>Annuler</button>
      <button class="btn pri danger-bg" onclick={remove}>Retirer</button>
    </div>
  </Modal>
{/if}
