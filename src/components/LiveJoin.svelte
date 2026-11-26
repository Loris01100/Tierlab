<script lang="ts">
  import { ApiError, apiGet } from '../lib/api';
  import { findLive, saveList } from '../lib/db';
  import { newList } from '../lib/model';
  import { go, listPath, replace } from '../lib/router.svelte';

  /** Lien #/live/<salle> : ouvre la copie locale reliée à cette salle, ou la crée (elle se remplit à la connexion). */
  let { room }: { room: string } = $props();

  const join = (async () => {
    const known = await findLive(room).catch(() => undefined);
    if (known) return replace(listPath(known.id));
    const { title } = await apiGet<{ title: string }>(`/live/${room}/info`);
    const list = { ...newList(title, []), live: room };
    await saveList(list);
    replace(listPath(list.id));
  })();
</script>

{#await join}
  <p class="loading">Connexion à la liste partagée…</p>
{:catch e}
  <div class="missing">
    <p>{e instanceof ApiError ? e.message : 'Impossible d’ouvrir cette liste partagée (stockage local bloqué ?).'}</p>
    <button class="btn pri" onclick={() => go('/')}>Retour à mes listes</button>
  </div>
{/await}
