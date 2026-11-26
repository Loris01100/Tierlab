<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CommunitySort } from '../../shared/community';
  import { CATALOGS, pendingCatalog, type CatalogTab } from '../lib/catalog';
  import { published } from '../lib/community.svelte';
  import { PALETTE, PRESETS } from '../lib/constants';
  import { allLists, deleteList, loadList, previewItems, saveList } from '../lib/db';
  import { blobUrl, releaseUrls } from '../lib/images';
  import { countTiles, newList, sampleList } from '../lib/model';
  import { COMMUNITY_PATH, go, listPath } from '../lib/router.svelte';
  import { saveShared, toShared } from '../lib/share';
  import { cycleTheme, theme, THEME_LABEL } from '../lib/theme.svelte';
  import { toast } from '../lib/toast.svelte';
  import type { Item, TierList } from '../lib/types';
  import { fold, isTyping, plural, pref, relTime, setPref } from '../lib/utils';
  import CommunityGrid from './CommunityGrid.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Modal from './Modal.svelte';
  import ImportModal from './modals/ImportModal.svelte';
  import NewListModal from './modals/NewListModal.svelte';

  /** Onglet affiché : mes listes (#/) ou la galerie communautaire (#/community). */
  let { tab = 'mine' }: { tab?: 'mine' | 'community' } = $props();

  /** Aperçu : nombre de rangs et de vignettes par rang affichés sur une carte. */
  const PREVIEW = { tiers: 5, perTier: 8 } as const;

  type Sort = 'recent' | 'az' | 'size';
  const SORTS: { id: Sort; label: string }[] = [
    { id: 'recent', label: 'Récentes' },
    { id: 'az', label: 'A → Z' },
    { id: 'size', label: 'Taille' },
  ];
  const CSORTS: { id: CommunitySort; label: string }[] = [
    { id: 'recent', label: 'Récentes' },
    { id: 'popular', label: 'Populaires' },
  ];

  /** Raccourcis « Démarrer vite » : un modèle de rangs, ou une liste classique ouverte sur un catalogue. */
  type Quick = { name: string; sub: string; badge: string } & ({ preset: keyof typeof PRESETS } | { catalog: CatalogTab });
  const QUICK: Quick[] = [
    { name: 'Classique', sub: 'S à F, 6 rangs', badge: 'S', preset: 'classic' },
    { name: 'Top / flop', sub: '3 rangs', badge: 'T', preset: 'tfm' },
    { name: 'Notes', sub: 'De 5 à 1', badge: '5', preset: 'notes' },
    { name: 'Musique', sub: 'Albums, titres', badge: 'MU', catalog: 'music' },
    { name: CATALOGS.pokemon.label, sub: 'Catalogue', badge: 'PO', catalog: 'pokemon' },
    { name: CATALOGS.anime.label, sub: 'Catalogue', badge: 'AN', catalog: 'anime' },
    { name: CATALOGS.books.label, sub: 'Catalogue', badge: 'LI', catalog: 'books' },
  ];

  let lists = $state<TierList[] | null>(null);
  let thumbs = $state.raw(new Map<string, Item>());
  let modal = $state<'new' | 'import' | { del: TierList } | null>(null);
  /** Id de la liste dont le menu « ⋮ » est ouvert. */
  let menu = $state<string | null>(null);
  let q = $state('');
  let sort = $state<Sort>(pref('tierlab-sort', 'recent'));
  let csort = $state<CommunitySort>(pref('tierlab-csort', 'recent'));
  let search = $state<HTMLInputElement>();

  const shown = $derived.by(() => {
    if (!lists) return [];
    const term = fold(q.trim());
    const out = term ? lists.filter((l) => fold(l.title).includes(term)) : [...lists];
    if (sort === 'az') out.sort((a, b) => (a.title || 'Sans titre').localeCompare(b.title || 'Sans titre', 'fr'));
    else if (sort === 'size') out.sort((a, b) => countTiles(b) - countTiles(a));
    return out;
  });

  function setSort(s: Sort) {
    sort = s;
    setPref('tierlab-sort', s);
  }

  function setCsort(s: CommunitySort) {
    csort = s;
    setPref('tierlab-csort', s);
  }

  async function refresh() {
    lists = await allLists();
    try {
      thumbs = await previewItems(lists, PREVIEW.perTier, PREVIEW.tiers);
    } catch {
      /* aperçus facultatifs */
    }
  }

  onMount(async () => {
    try {
      await refresh();
      if (lists!.length || pref('tierlab-seeded', false)) return;
      // Premier lancement : reprend la liste du prototype (MainList_v1.html, même origine) ou crée l'exemple.
      let migrated = false;
      try {
        const old = localStorage.getItem('tierlab-v1');
        if (old) migrated = !!(await saveShared(JSON.parse(old)));
      } catch {
        /* rien à reprendre */
      }
      if (!migrated) {
        const s = sampleList();
        await saveList(s.list, s.items);
      }
      setPref('tierlab-seeded', true);
      await refresh();
    } catch {
      lists = [];
      toast('Stockage local indisponible');
    }
  });

  onDestroy(releaseUrls);

  async function create(title: string, tiers: string[]) {
    const l = newList(title, tiers);
    await saveList(l);
    go(listPath(l.id));
  }

  async function quick(t: Quick) {
    try {
      if ('preset' in t) return await create('Ma tier liste', PRESETS[t.preset].tiers);
      pendingCatalog.tab = t.catalog;
      await create(`Tier liste ${t.name}`, PRESETS.classic.tiers);
    } catch {
      pendingCatalog.tab = null;
      toast('Sauvegarde impossible (stockage plein ou bloqué)');
    }
  }

  async function importCode(code: string): Promise<boolean> {
    let raw: unknown;
    try {
      raw = JSON.parse(code);
    } catch {
      return false;
    }
    const id = await saveShared(raw);
    if (!id) return false;
    go(listPath(id));
    return true;
  }

  /** Code de partage d'une liste enregistrée (vignettes lues depuis IndexedDB). */
  async function sharedOf(l: TierList) {
    const data = await loadList(l.id);
    if (!data) return null;
    const items = Object.fromEntries(data.items.map((i) => [i.id, i]));
    return toShared({ ...data.list, items });
  }

  async function duplicate(l: TierList) {
    menu = null;
    const shared = await sharedOf(l);
    const id = shared && (await saveShared(shared, `${l.title || 'Sans titre'} (copie)`));
    if (id) {
      toast('Liste dupliquée');
      await refresh();
    }
  }

  async function copyCode(l: TierList) {
    menu = null;
    try {
      const shared = await sharedOf(l);
      if (!shared) return;
      await navigator.clipboard.writeText(JSON.stringify(shared));
      toast('Code de partage copié');
    } catch {
      toast('Copie impossible : utilisez « Partager » dans la liste');
    }
  }

  async function remove(l: TierList) {
    await deleteList(l.id);
    modal = null;
    toast('Liste supprimée');
    await refresh();
  }

  function onwinclick(e: MouseEvent) {
    if (menu && !(e.target as Element).closest('.lmenu, .lmore')) menu = null;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && menu) menu = null;
    else if (e.key === '/' && !modal && !isTyping(document.activeElement)) {
      e.preventDefault();
      search?.focus();
    }
  }
</script>

<svelte:window onclick={onwinclick} {onkeydown} />

<header class="top">
  <div class="brand">
    <Logo />
  </div>
  <label class="lsearch">
    <Icon name="search" />
    <input
      type="search"
      placeholder={tab === 'community' ? 'Rechercher dans la communauté…' : 'Rechercher une liste…'}
      aria-label={tab === 'community' ? 'Rechercher dans la communauté' : 'Rechercher une liste'}
      bind:this={search}
      bind:value={q}
    />
    <kbd aria-hidden="true">/</kbd>
  </label>
  <div class="acts">
    <button class="ib big" aria-label={THEME_LABEL[theme.value]} title={THEME_LABEL[theme.value]} onclick={cycleTheme}>
      <Icon name={theme.value === 'auto' ? 'auto' : theme.value === 'light' ? 'sun' : 'moon'} />
    </button>
    <button class="btn" aria-label="Importer un code" onclick={() => (modal = 'import')}><Icon name="code" /><span>Importer un code</span></button>
    <button class="btn pri" aria-label="Nouvelle tier liste" onclick={() => (modal = 'new')}><Icon name="plus" /><span>Nouvelle tier liste</span></button>
  </div>
</header>

<main class="lib">
  <section>
    <div class="lib-row">
      <h2 class="lib-h2">Démarrer vite</h2>
      <span class="lib-sub">Un modèle de rangs, ou un catalogue pour remplir la liste en deux clics</span>
    </div>
    <div class="quick">
      {#each QUICK as t, i (t.name)}
        <button class="qk" onclick={() => quick(t)}>
          <i style:--c={PALETTE[i % PALETTE.length]}>{t.badge}</i>
          <span><b>{t.name}</b><small>{t.sub}</small></span>
        </button>
      {/each}
    </div>
  </section>

  <section>
    <div class="lib-row">
      <nav class="ltabs" aria-label="Listes">
        <a class="lib-h" href="#/" aria-current={tab === 'mine' ? 'page' : undefined}
          >Mes tier listes{#if lists}<span class="count">{lists.length}</span>{/if}</a
        >
        <a class="lib-h" href="#{COMMUNITY_PATH}" aria-current={tab === 'community' ? 'page' : undefined}>Communauté</a>
      </nav>
      {#if tab === 'community'}
        <div class="sort" role="group" aria-label="Trier les listes publiées">
          {#each CSORTS as s (s.id)}
            <button aria-pressed={csort === s.id} onclick={() => setCsort(s.id)}>{s.label}</button>
          {/each}
        </div>
      {:else}
        <div class="sort" role="group" aria-label="Trier les listes">
          {#each SORTS as s (s.id)}
            <button aria-pressed={sort === s.id} onclick={() => setSort(s.id)}>{s.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    {#if tab === 'community'}
      <CommunityGrid {q} sort={csort} />
    {:else if lists === null}
      <p class="loading">Chargement…</p>
    {:else}
      <ul class="lgrid">
        {#if !q.trim()}
          <li class="lnew">
            <button onclick={() => (modal = 'new')}>
              <span class="plus"><Icon name="plus" /></span>
              {lists.length ? 'Nouvelle tier liste' : 'Créer ma première liste'}
              <small>Choisir le titre et les rangs</small>
            </button>
          </li>
        {/if}
        {#each shown as l (l.id)}
          {@const n = countTiles(l)}
          <li class="lcard" class:menu={menu === l.id}>
            <a class="lopen" href="#{listPath(l.id)}" aria-label="Ouvrir {l.title || 'Sans titre'}">
              <span class="mini" aria-hidden="true">
                {#each l.tiers.slice(0, PREVIEW.tiers) as t (t.id)}
                  <span class="mrow">
                    <i style:--c={t.color}>{t.name.slice(0, 3)}</i>
                    <span class="mtiles">
                      {#each t.items.slice(0, PREVIEW.perTier) as id (id)}
                        {@const it = thumbs.get(id)}
                        {#if it?.type === 'img' && it.blob}<img src={blobUrl(it.blob)} alt="" />{:else}<b style:--c={it?.bg}></b>{/if}
                      {/each}
                    </span>
                  </span>
                {/each}
              </span>
            </a>
            <div class="lbody">
              <div class="ltxt">
                <span class="ltitle">{l.title || 'Sans titre'}</span>
                <span class="lmeta">
                  <span class="pill">{plural(n, 'vignette')}</span>
                  <span class="pill">{plural(l.tiers.length, 'rang')}</span>
                  {#if l.live}<span class="pill">Partagée</span>{/if}
                  <time datetime={new Date(l.updatedAt).toISOString()}>{relTime(l.updatedAt)}</time>
                </span>
              </div>
              <button
                class="ib lmore"
                aria-label="Actions pour {l.title || 'Sans titre'}"
                aria-haspopup="menu"
                aria-expanded={menu === l.id}
                title="Actions"
                onclick={() => (menu = menu === l.id ? null : l.id)}><Icon name="more" /></button
              >
              {#if menu === l.id}
                <div class="lmenu" role="menu" aria-label="Actions pour {l.title || 'Sans titre'}">
                  <a role="menuitem" href="#{listPath(l.id)}"><Icon name="open" />Ouvrir</a>
                  <button role="menuitem" onclick={() => duplicate(l)}><Icon name="copy" />Dupliquer</button>
                  <button role="menuitem" onclick={() => copyCode(l)}><Icon name="code" />Copier le code</button>
                  <button role="menuitem" class="danger" onclick={() => ((menu = null), (modal = { del: l }))}><Icon name="trash" />Supprimer</button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if q.trim() && !shown.length}
        <p class="loading">Aucune liste ne correspond à « {q.trim()} ».</p>
      {/if}
    {/if}
  </section>
</main>

{#if modal === 'new'}
  <NewListModal onclose={() => (modal = null)} oncreate={create} />
{:else if modal === 'import'}
  <ImportModal onclose={() => (modal = null)} onimport={importCode} />
{:else if modal}
  {@const l = modal.del}
  <Modal title="Supprimer la liste ?" onclose={() => (modal = null)}>
    <p>« {l.title || 'Sans titre'} » et ses {plural(countTiles(l), 'vignette')} seront supprimées définitivement.</p>
    {#if published[l.id]}
      <p class="small">Sa copie publiée reste visible dans la communauté : vous pourrez toujours la retirer depuis sa page (« La vôtre »).</p>
    {/if}
    <div class="foot">
      <button class="btn" onclick={() => (modal = null)}>Annuler</button>
      <button class="btn pri danger-bg" onclick={() => remove(l)}>Supprimer</button>
    </div>
  </Modal>
{/if}
