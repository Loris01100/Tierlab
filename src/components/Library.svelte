<script lang="ts">
  import { onMount } from 'svelte';
  import { allLists, deleteList, loadList, saveList } from '../lib/db';
  import { countTiles, newList, sampleList } from '../lib/model';
  import { go, listPath } from '../lib/router.svelte';
  import { fromShared, toShared } from '../lib/share';
  import { toast } from '../lib/toast.svelte';
  import type { TierList } from '../lib/types';
  import { plural, pref, setPref, uid } from '../lib/utils';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ImportModal from './modals/ImportModal.svelte';
  import NewListModal from './modals/NewListModal.svelte';

  let lists = $state<TierList[] | null>(null);
  let modal = $state<'new' | 'import' | { del: TierList } | null>(null);

  const refresh = async () => (lists = await allLists());

  /** Crée une liste à partir de données importées (code partagé, prototype). */
  async function createFrom(raw: unknown): Promise<string | null> {
    const id = uid();
    const d = await fromShared(raw, id);
    if (!d) return null;
    const now = Date.now();
    await saveList({ id, title: d.title || 'Tier liste importée', tiers: d.tiers, pool: d.pool, createdAt: now, updatedAt: now }, d.items);
    return id;
  }

  onMount(async () => {
    try {
      await refresh();
      if (lists!.length || pref('tierlab-seeded', false)) return;
      // Premier lancement : reprend la liste du prototype (MainList_v1.html, même origine) ou crée l'exemple.
      let migrated = false;
      try {
        const old = localStorage.getItem('tierlab-v1');
        if (old) migrated = !!(await createFrom(JSON.parse(old)));
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

  async function create(title: string, tiers: string[]) {
    const l = newList(title, tiers);
    await saveList(l);
    go(listPath(l.id));
  }

  async function importCode(code: string): Promise<boolean> {
    let raw: unknown;
    try {
      raw = JSON.parse(code);
    } catch {
      return false;
    }
    const id = await createFrom(raw);
    if (!id) return false;
    go(listPath(id));
    return true;
  }

  async function duplicate(l: TierList) {
    const data = await loadList(l.id);
    if (!data) return;
    const items = Object.fromEntries(data.items.map((i) => [i.id, i]));
    const shared = await toShared({ ...data.list, items });
    const id = await createFrom({ ...shared, title: `${l.title || 'Sans titre'} (copie)` });
    if (id) {
      toast('Liste dupliquée');
      await refresh();
    }
  }

  async function remove(l: TierList) {
    await deleteList(l.id);
    modal = null;
    toast('Liste supprimée');
    await refresh();
  }

  const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<header class="top">
  <div class="brand">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"
      ><rect x="2" y="3" width="20" height="5" rx="1.5" fill="#ff7f7f" /><rect x="2" y="10" width="14" height="5" rx="1.5" fill="#ffdf7f" /><rect
        x="2"
        y="17"
        width="8"
        height="5"
        rx="1.5"
        fill="#7fbfff"
      /></svg
    >Tierlab
  </div>
  <div class="acts push">
    <button class="btn" onclick={() => (modal = 'import')}><Icon name="code" /><span>Importer un code</span></button>
    <button class="btn pri" onclick={() => (modal = 'new')}><Icon name="new" /><span>Nouvelle tier liste</span></button>
  </div>
</header>

<main>
  <h1 class="lib-h">Mes tier listes</h1>
  {#if lists === null}
    <p class="loading">Chargement…</p>
  {:else if !lists.length}
    <div class="missing">
      <p>Aucune tier liste pour l’instant.</p>
      <button class="btn pri" onclick={() => (modal = 'new')}><Icon name="plus" />Créer ma première liste</button>
    </div>
  {:else}
    <ul class="lists">
      {#each lists as l (l.id)}
        {@const n = countTiles(l)}
        <li class="lcard">
          <a class="lopen" href="#{listPath(l.id)}">
            <span class="mini" aria-hidden="true">
              {#each l.tiers.slice(0, 6) as t (t.id)}
                <span class="mrow"><i style:--c={t.color}></i><b style:--w="{Math.min(100, t.items.length * 12)}%"></b></span>
              {/each}
            </span>
            <span class="ltitle">{l.title || 'Sans titre'}</span>
            <span class="lmeta">{plural(n, 'vignette')} · {plural(l.tiers.length, 'rang')} · {fmt.format(l.updatedAt)}</span>
          </a>
          <div class="lacts">
            <button class="ib" aria-label="Dupliquer {l.title}" title="Dupliquer" onclick={() => duplicate(l)}><Icon name="copy" /></button>
            <button class="ib" aria-label="Supprimer {l.title}" title="Supprimer" onclick={() => (modal = { del: l })}><Icon name="trash" /></button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if modal === 'new'}
  <NewListModal onclose={() => (modal = null)} oncreate={create} />
{:else if modal === 'import'}
  <ImportModal onclose={() => (modal = null)} onimport={importCode} />
{:else if modal}
  {@const l = modal.del}
  <Modal title="Supprimer la liste ?" onclose={() => (modal = null)}>
    <p>« {l.title || 'Sans titre'} » et ses {plural(countTiles(l), 'vignette')} seront supprimées définitivement.</p>
    <div class="foot">
      <button class="btn" onclick={() => (modal = null)}>Annuler</button>
      <button class="btn pri danger-bg" onclick={() => remove(l)}>Supprimer</button>
    </div>
  </Modal>
{/if}
