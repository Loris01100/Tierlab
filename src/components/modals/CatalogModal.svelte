<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fetchImage, imageUrl, mapLimit } from '../../lib/api';
  import { CATALOGS, catalogList, searchCatalog, type CatalogHit, type CatalogId } from '../../lib/catalog';
  import { LIMITS } from '../../lib/constants';
  import type { Editor } from '../../lib/editor.svelte';
  import { shrink } from '../../lib/images';
  import { toast } from '../../lib/toast.svelte';
  import { plural } from '../../lib/utils';
  import Modal from '../Modal.svelte';
  import MusicPanel from './MusicPanel.svelte';

  let { ed, onclose }: { ed: Editor; onclose: () => void } = $props();

  const IDS = Object.keys(CATALOGS) as CatalogId[];

  /** La musique a son propre parcours (artiste → sorties) : elle n'est pas un catalogue générique. */
  let tab = $state<CatalogId | 'music'>('music');
  let source = $state<CatalogId>('pokemon');
  const def = $derived(CATALOGS[source]);
  let q = $state('');
  /** Liste prédéfinie affichée (génération, top…), ou null pour la recherche. */
  let listId = $state<string | null>(null);
  let hits = $state.raw<CatalogHit[]>([]);
  let loading = $state(false);
  let err = $state('');

  $effect(() => {
    const src = source;
    const list = listId;
    const term = q.trim();
    if (!list && !term) {
      hits = [];
      err = '';
      loading = false;
      return;
    }
    const ctl = new AbortController();
    // Saisie : on attend la fin de la frappe. Liste : chargement immédiat.
    const t = setTimeout(
      async () => {
        loading = true;
        err = '';
        try {
          hits = list ? await catalogList(src, list, ctl.signal) : await searchCatalog(src, term, ctl.signal);
          if (!hits.length) err = 'Aucun résultat';
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            hits = [];
            err = (e as Error).message;
          }
        } finally {
          if (!ctl.signal.aborted) loading = false;
        }
      },
      list ? 0 : 300,
    );
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  });

  /* ---------- sélection : conservée d'une recherche et d'un catalogue à l'autre ---------- */
  interface Picked {
    source: CatalogId;
    hit: CatalogHit;
  }
  let picked = $state.raw<Map<string, Picked>>(new Map());
  const keyOf = (h: CatalogHit, src: CatalogId = source) => `${src}:${h.id}`;
  const tooMany = $derived(picked.size > LIMITS.importApi);
  const allShown = $derived(hits.length > 0 && hits.every((h) => picked.has(keyOf(h))));

  function toggle(h: CatalogHit) {
    const m = new Map(picked);
    if (!m.delete(keyOf(h))) m.set(keyOf(h), { source, hit: h });
    picked = m;
  }
  function toggleShown() {
    const m = new Map(picked);
    for (const h of hits) {
      if (allShown) m.delete(keyOf(h));
      else m.set(keyOf(h), { source, hit: h });
    }
    picked = m;
  }

  function pickTab(id: CatalogId | 'music') {
    tab = id;
    if (id === 'music') return;
    source = id;
    listId = null;
  }
  function pickList(id: string) {
    q = '';
    listId = id;
  }

  /* ---------- import ---------- */
  let busy = $state(false);
  let progress = $state('');
  const abort = new AbortController();
  onDestroy(() => abort.abort());

  /** Image réduite, ou undefined si indisponible (la vignette devient alors du texte). */
  async function cover(h: CatalogHit): Promise<Blob | undefined> {
    if (!h.image) return undefined;
    try {
      return await shrink(await fetchImage(h.image, abort.signal));
    } catch {
      return undefined;
    }
  }

  async function run() {
    if (!picked.size || tooMany || busy) return;
    busy = true;
    const chosen = [...picked.values()];
    let done = 0;
    progress = `Récupération 0/${chosen.length}…`;
    try {
      const entries = await mapLimit(chosen, 4, async ({ hit }) => {
        const blob = await cover(hit);
        progress = `Récupération ${++done}/${chosen.length}…`;
        return { text: hit.name, blob };
      });
      if (abort.signal.aborted) return;
      const sources = new Set(chosen.map((p) => p.source));
      const untitled = !ed.title.trim() || ed.title === 'Ma tier liste';
      ed.addEntries(entries);
      if (untitled && sources.size === 1) ed.setTitleLive(CATALOGS[chosen[0].source].label);
      toast(`${plural(entries.length, 'vignette')} ajoutée${entries.length > 1 ? 's' : ''}`);
      onclose();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      toast((e as Error).message || 'Import impossible');
      busy = false;
      progress = '';
    }
  }
</script>

<Modal title="Catalogues" {onclose}>
  <div class="seg" role="radiogroup" aria-label="Catégorie">
    {#snippet choice(id: CatalogId | 'music', label: string)}
      <label class:on={tab === id}>
        <input type="radio" name="catSrc" value={id} checked={tab === id} onchange={() => pickTab(id)} disabled={busy} />
        {label}
      </label>
    {/snippet}
    {@render choice('music', 'Musique')}
    {#each IDS as id (id)}{@render choice(id, CATALOGS[id].label)}{/each}
  </div>

  {#if tab === 'music'}
    <MusicPanel {ed} {onclose} />
  {:else}
    <p class="small">{def.hint} Source : {def.credit}.</p>

    <label for="cQ">Recherche</label>
    <input
      type="text"
      id="cQ"
      bind:value={q}
      oninput={() => (listId = null)}
      placeholder={def.placeholder}
      autocomplete="off"
      maxlength="100"
      disabled={busy}
    />
    {#if def.lists.length}
      <div class="seg lists" aria-label="Listes prédéfinies">
        {#each def.lists as l (l.id)}
          <button class="btn sm" class:on={listId === l.id} aria-pressed={listId === l.id} onclick={() => pickList(l.id)} disabled={busy}>
            {l.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if loading}
      <p class="small">Chargement…</p>
    {:else if err}
      <p class="small err">{err}</p>
    {:else if hits.length}
      <div class="mhead">
        <span class="small">{plural(hits.length, 'résultat')}</span>
        <button class="btn sm" onclick={toggleShown} disabled={busy}>{allShown ? 'Tout décocher' : 'Tout cocher'}</button>
      </div>
      <ul class="mlist albums">
        {#each hits as h (h.id)}
          <li>
            <label class="mrow-b">
              <input type="checkbox" checked={picked.has(keyOf(h))} onchange={() => toggle(h)} disabled={busy} />
              {#if h.image}<img class="cov" src={imageUrl(h.image)} alt="" loading="lazy" />{:else}<span class="cov"></span>{/if}
              <span class="mtxt"><b>{h.name}</b>{#if h.detail}<small>{h.detail}</small>{/if}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    {#if tooMany}<p class="small err">{picked.size} vignettes : c’est au-delà de la limite de {LIMITS.importApi}. Décochez des éléments.</p>{/if}
    {#if progress}<p class="small" aria-live="polite">{progress}</p>{/if}
    <div class="foot">
      {#if picked.size}<button class="btn l" onclick={() => (picked = new Map())} disabled={busy}>Vider la sélection</button>{/if}
      <button class="btn" onclick={onclose}>Annuler</button>
      <button class="btn pri" onclick={run} disabled={busy || !picked.size || tooMany}>
        {busy ? 'Import…' : `Ajouter ${plural(picked.size, 'vignette')}`}
      </button>
    </div>
  {/if}
</Modal>
