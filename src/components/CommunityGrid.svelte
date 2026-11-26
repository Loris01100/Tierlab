<script lang="ts">
  import type { CommunityCard, CommunitySort } from '../../shared/community';
  import { ApiError } from '../lib/api';
  import { communityImg, fetchPage, ownerOf } from '../lib/community.svelte';
  import { communityPath } from '../lib/router.svelte';
  import { plural, relTime } from '../lib/utils';

  /** Galerie des listes publiées (onglet « Communauté » de la bibliothèque). */
  let { q, sort }: { q: string; sort: CommunitySort } = $props();

  let cards = $state<CommunityCard[] | null>(null);
  let more = $state(false);
  let page = $state(0);
  let error = $state('');
  let loadingMore = $state(false);
  /** Relance du chargement (bouton « Réessayer »). */
  let attempt = $state(0);

  const msg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Galerie indisponible');

  /** Requête affichée (recherche + tri) : « Voir plus » l'utilise pour être annulé si la recherche change entre-temps. */
  let current = new AbortController();

  $effect(() => {
    const term = q.trim();
    const s = sort;
    void attempt;
    const ctrl = new AbortController();
    current = ctrl;
    // Saisie : on attend une courte pause avant d'interroger le serveur.
    const t = setTimeout(
      async () => {
        try {
          const r = await fetchPage(term, s, 0, ctrl.signal);
          cards = r.lists;
          more = r.more;
          page = 0;
          error = '';
        } catch (e) {
          if ((e as Error).name !== 'AbortError') error = msg(e);
        }
      },
      term ? 250 : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  async function loadMore() {
    const { signal } = current;
    loadingMore = true;
    try {
      const r = await fetchPage(q.trim(), sort, page + 1, signal);
      if (signal.aborted) return;
      const known = new Set(cards?.map((c) => c.id));
      cards = [...(cards ?? []), ...r.lists.filter((c) => !known.has(c.id))];
      more = r.more;
      page++;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = msg(e);
    } finally {
      loadingMore = false;
    }
  }
</script>

{#if error && !cards}
  <div class="missing">
    <p>{error}</p>
    <button class="btn" onclick={() => ((error = ''), attempt++)}>Réessayer</button>
  </div>
{:else if cards === null}
  <p class="loading">Chargement…</p>
{:else if !cards.length}
  <p class="loading">
    {#if q.trim()}
      Aucune liste publiée ne correspond à « {q.trim()} ».
    {:else}
      Personne n’a encore publié de liste. Ouvrez une de vos listes, puis « Partager » → « Publier dans la communauté ».
    {/if}
  </p>
{:else}
  <ul class="lgrid">
    {#each cards as c (c.id)}
      <li class="lcard">
        <a class="lopen" href="#{communityPath(c.id)}" aria-label="Voir {c.title}">
          <span class="mini" aria-hidden="true">
            {#each c.preview as t, i (i)}
              <span class="mrow">
                <i style:--c={t.color}>{t.name.slice(0, 3)}</i>
                <span class="mtiles">
                  {#each t.items as it (it.id)}
                    {#if it.type === 'img'}<img src={communityImg(c.id, it.id)} alt="" loading="lazy" />{:else}<b style:--c={it.bg}></b>{/if}
                  {/each}
                </span>
              </span>
            {/each}
          </span>
        </a>
        <div class="lbody">
          <div class="ltxt">
            <span class="ltitle">{c.title}</span>
            <span class="lmeta">
              <span class="pill">{c.author ? `par ${c.author}` : 'Anonyme'}</span>
              <span class="pill">{plural(c.tiles, 'vignette')}</span>
              {#if c.copies}<span class="pill">{plural(c.copies, 'copie')}</span>{/if}
              {#if ownerOf(c.id)}<span class="pill own">La vôtre</span>{/if}
              <time datetime={new Date(c.updated).toISOString()}>{relTime(c.updated)}</time>
            </span>
          </div>
        </div>
      </li>
    {/each}
  </ul>
  {#if error}<p class="small err">{error}</p>{/if}
  {#if more}
    <button class="btn more" disabled={loadingMore} onclick={loadMore}>{loadingMore ? 'Chargement…' : 'Voir plus de listes'}</button>
  {/if}
{/if}
