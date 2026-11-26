<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fetchImage, imageUrl, mapLimit } from '../../lib/api';
  import { LIMITS } from '../../lib/constants';
  import type { Editor } from '../../lib/editor.svelte';
  import { shrink } from '../../lib/images';
  import {
    albumTracks,
    artistAlbums,
    searchArtists,
    type AlbumGroup,
    type AlbumInfo,
    type ArtistHit,
  } from '../../lib/music';
  import { toast } from '../../lib/toast.svelte';
  import { plural } from '../../lib/utils';
  import Modal from '../Modal.svelte';

  let { ed, onclose }: { ed: Editor; onclose: () => void } = $props();

  const GROUPS: { key: AlbumGroup; label: string }[] = [
    { key: 'album', label: 'Albums' },
    { key: 'single', label: 'Singles et EP' },
    { key: 'compilation', label: 'Compilations' },
  ];
  const TYPE_LABEL: Record<AlbumGroup, string> = { album: 'Album', single: 'Single', compilation: 'Compilation' };

  /* ---------- étape 1 : recherche d'artiste ---------- */
  let q = $state('');
  let artists = $state<ArtistHit[]>([]);
  let searching = $state(false);
  let searchErr = $state('');

  $effect(() => {
    const term = q.trim();
    if (!term) {
      artists = [];
      searchErr = '';
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      searching = true;
      try {
        artists = await searchArtists(term, ctl.signal);
        searchErr = artists.length ? '' : 'Aucun artiste trouvé';
      } catch (e) {
        if ((e as Error).name !== 'AbortError') searchErr = (e as Error).message;
      } finally {
        if (!ctl.signal.aborted) searching = false;
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  });

  /* ---------- étape 2 : discographie ---------- */
  let artist = $state<ArtistHit | null>(null);
  let groups = $state<AlbumGroup[]>(['album', 'single']);
  let albums = $state<AlbumInfo[]>([]);
  let picked = $state<Set<string>>(new Set());
  let loading = $state(false);
  let loadErr = $state('');
  let mode = $state<'albums' | 'tracks'>('albums');
  let dedupe = $state(true);

  $effect(() => {
    const a = artist;
    const g = [...groups];
    if (!a) return;
    const ctl = new AbortController();
    loading = true;
    loadErr = '';
    artistAlbums(a.id, g, ctl.signal)
      .then((list) => {
        albums = list;
        picked = new Set(list.map((x) => x.id));
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') {
          albums = [];
          loadErr = e.message;
        }
      })
      .finally(() => {
        if (!ctl.signal.aborted) loading = false;
      });
    return () => ctl.abort();
  });

  const chosen = $derived(albums.filter((a) => picked.has(a.id)));
  // En mode titres, le nombre exact n'est connu qu'à l'import : il est alors plafonné à LIMITS.importApi.
  const tooMany = $derived(mode === 'albums' && chosen.length > LIMITS.importApi);

  function toggle(id: string) {
    const s = new Set(picked);
    if (!s.delete(id)) s.add(id);
    picked = s;
  }
  const toggleAll = () => (picked = picked.size === albums.length ? new Set() : new Set(albums.map((a) => a.id)));

  /* ---------- import ---------- */
  let busy = $state(false);
  let progress = $state('');
  const abort = new AbortController();
  onDestroy(() => abort.abort());

  /** Pochette réduite, ou undefined si indisponible (la vignette devient alors du texte). */
  async function cover(a: AlbumInfo): Promise<Blob | undefined> {
    if (!a.image) return undefined;
    try {
      return await shrink(await fetchImage(a.image, abort.signal));
    } catch {
      return undefined;
    }
  }

  async function run() {
    if (!artist || !chosen.length || tooMany || busy) return;
    busy = true;
    let done = 0;
    const total = chosen.length;
    progress = `Récupération 0/${total}…`;
    try {
      const perAlbum = await mapLimit(chosen, 4, async (a) => {
        const [blob, tracks] = await Promise.all([cover(a), mode === 'tracks' ? albumTracks(a.id, abort.signal) : Promise.resolve(null)]);
        progress = `Récupération ${++done}/${total}…`;
        return tracks ? tracks.map((t) => ({ text: t.name, blob })) : [{ text: a.name, blob }];
      });
      let entries = perAlbum.flat();
      if (mode === 'tracks' && dedupe) {
        const seen = new Set<string>();
        entries = entries.filter((e) => {
          const k = e.text.toLocaleLowerCase().trim();
          return !seen.has(k) && !!seen.add(k);
        });
      }
      const capped = entries.length > LIMITS.importApi;
      entries = entries.slice(0, LIMITS.importApi);
      if (abort.signal.aborted) return;
      const untitled = !ed.title.trim() || ed.title === 'Ma tier liste';
      ed.addEntries(entries);
      if (untitled) ed.setTitleLive(mode === 'albums' ? `Albums de ${artist.name}` : `Titres de ${artist.name}`);
      toast(`${plural(entries.length, 'vignette')} ajoutée${entries.length > 1 ? 's' : ''}${capped ? ` (limite de ${LIMITS.importApi} atteinte)` : ''}`);
      onclose();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      toast((e as Error).message || 'Import impossible');
      busy = false;
      progress = '';
    }
  }
</script>

<Modal title={artist ? artist.name : 'Musique'} {onclose}>
  {#if !artist}
    <p class="small">Recherchez un artiste (catalogue Deezer) pour importer les pochettes et les noms de ses albums ou de ses titres.</p>
    <label for="mQ">Artiste</label>
    <input type="text" id="mQ" bind:value={q} placeholder="Ex. Daft Punk" autocomplete="off" maxlength="100" />
    {#if searching}<p class="small">Recherche…</p>{:else if searchErr}<p class="small err">{searchErr}</p>{/if}
    {#if artists.length}
      <ul class="mlist">
        {#each artists as a (a.id)}
          <li>
            <button class="mrow-b" onclick={() => (artist = a)}>
              {#if a.image}<img class="av" src={imageUrl(a.image)} alt="" loading="lazy" />{:else}<span class="av"></span>{/if}
              <span class="mtxt"><b>{a.name}</b>{#if a.albums}<small>{plural(a.albums, 'sortie')}</small>{/if}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="foot"><button class="btn" onclick={onclose}>Fermer</button></div>
  {:else}
    <span class="lbl">Sorties</span>
    <div class="chk">
      {#each GROUPS as g (g.key)}
        <label><input type="checkbox" value={g.key} bind:group={groups} disabled={busy} />{g.label}</label>
      {/each}
    </div>
    <span class="lbl">Une vignette par</span>
    <div class="chk">
      <label><input type="radio" value="albums" bind:group={mode} disabled={busy} />Album (pochette + titre de l’album)</label>
      <label><input type="radio" value="tracks" bind:group={mode} disabled={busy} />Titre (pochette + nom du morceau)</label>
      {#if mode === 'tracks'}<label><input type="checkbox" bind:checked={dedupe} disabled={busy} />Ignorer les titres en double</label>{/if}
    </div>

    {#if loading}
      <p class="small">Chargement de la discographie…</p>
    {:else if loadErr}
      <p class="small err">{loadErr}</p>
    {:else if !albums.length}
      <p class="small">Aucune sortie dans ces catégories.</p>
    {:else}
      <div class="mhead">
        <span class="small">{plural(picked.size, 'sortie')} sur {albums.length}</span>
        <button class="btn sm" onclick={toggleAll} disabled={busy}>{picked.size === albums.length ? 'Tout décocher' : 'Tout cocher'}</button>
      </div>
      <ul class="mlist albums">
        {#each albums as a (a.id)}
          <li>
            <label class="mrow-b">
              <input type="checkbox" checked={picked.has(a.id)} onchange={() => toggle(a.id)} disabled={busy} />
              {#if a.image}<img class="cov" src={imageUrl(a.image)} alt="" loading="lazy" />{:else}<span class="cov"></span>{/if}
              <span class="mtxt"><b>{a.name}</b><small>{TYPE_LABEL[a.type] ?? a.type}{a.year ? ` · ${a.year}` : ''}</small></span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    {#if tooMany}<p class="small err">{chosen.length} vignettes : c’est au-delà de la limite de {LIMITS.importApi}. Décochez des sorties.</p>{/if}
    {#if progress}<p class="small" aria-live="polite">{progress}</p>{/if}
    <div class="foot">
      <button class="btn l" onclick={() => ((artist = null), (albums = []))} disabled={busy}>Changer d’artiste</button>
      <button class="btn" onclick={onclose}>Annuler</button>
      <button class="btn pri" onclick={run} disabled={busy || loading || !chosen.length || tooMany}>
        {busy ? 'Import…' : mode === 'tracks' ? `Ajouter les titres (${plural(chosen.length, 'sortie')})` : `Ajouter ${plural(chosen.length, 'vignette')}`}
      </button>
    </div>
  {/if}
</Modal>
