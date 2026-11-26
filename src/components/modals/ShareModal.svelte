<script lang="ts">
  import { onMount } from 'svelte';
  import { COMMUNITY } from '../../../shared/community';
  import { ApiError } from '../../lib/api';
  import { publish, published, republish, unpublish } from '../../lib/community.svelte';
  import type { Editor } from '../../lib/editor.svelte';
  import { createRoom } from '../../lib/live.svelte';
  import { communityPath, livePath } from '../../lib/router.svelte';
  import { toShared } from '../../lib/share';
  import { toast } from '../../lib/toast.svelte';
  import { plural, pref, setPref } from '../../lib/utils';
  import Icon from '../Icon.svelte';
  import Modal from '../Modal.svelte';

  let { ed, onclose }: { ed: Editor; onclose: () => void } = $props();

  let code = $state('');
  let out: HTMLTextAreaElement;
  let linkIn = $state<HTMLInputElement>();

  onMount(async () => {
    code = JSON.stringify(await toShared({ title: ed.title, tiers: ed.tiers, pool: ed.pool, items: ed.items }));
  });

  async function copy(text: string, field: HTMLInputElement | HTMLTextAreaElement | undefined, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      field?.focus();
      field?.select();
      toast('Texte sélectionné : faites Ctrl+C');
    }
  }

  /* ---------- édition partagée ---------- */
  const link = $derived(ed.live ? `${location.origin}${location.pathname}#${livePath(ed.live.room)}` : '');
  const liveText = $derived.by(() => {
    const l = ed.live;
    if (!l) return '';
    if (l.status === 'online') return `${plural(l.peers, 'personne')} sur la liste en ce moment.`;
    if (l.status === 'gone') return 'Ce lien n’existe plus sur le serveur : la liste n’est plus synchronisée.';
    return l.status === 'offline' ? 'Hors ligne, reconnexion en cours…' : 'Connexion au serveur…';
  });
  let busy = $state(false);
  let sent = $state<{ done: number; total: number } | null>(null);
  let confirmLeave = $state(false);

  async function start() {
    busy = true;
    try {
      // Les modifications faites pendant l'envoi seraient perdues pour les autres : on fige d'abord la sauvegarde.
      await ed.flush();
      const room = await createRoom(ed, (done, total) => (sent = { done, total }));
      ed.goLive(room);
      toast('Lien d’édition partagée créé');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Création du lien impossible');
    } finally {
      busy = false;
      sent = null;
    }
  }

  /* ---------- communauté ---------- */
  const pub = $derived(published[ed.id]);
  let author = $state(pref('tierlab-author', ''));
  let pubBusy = $state(false);
  let confirmUnpub = $state(false);

  async function sendPub() {
    pubBusy = true;
    setPref('tierlab-author', author.trim());
    try {
      await ed.flush();
      if (pub) {
        await republish(ed, author);
        toast('Publication mise à jour');
      } else {
        await publish(ed, author);
        toast('Liste publiée dans la communauté');
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Publication impossible');
    } finally {
      pubBusy = false;
    }
  }

  async function unpub() {
    confirmUnpub = false;
    pubBusy = true;
    try {
      await unpublish(ed.id);
      toast('Liste retirée de la communauté');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Retrait impossible');
    } finally {
      pubBusy = false;
    }
  }

  function leave() {
    ed.leaveLive();
    confirmLeave = false;
    toast('Cette liste n’est plus synchronisée');
  }
</script>

<Modal title="Partager" {onclose}>
  <h3 class="msub">Éditer à plusieurs, en direct</h3>
  {#if ed.live}
    <label for="shLink">Lien à envoyer : toute personne qui l’ouvre peut modifier cette liste</label>
    <div class="linkrow">
      <input bind:this={linkIn} id="shLink" type="text" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
      <button class="btn pri" onclick={() => copy(link, linkIn, 'Lien copié')}>Copier le lien</button>
    </div>
    <p class="small">
      {liveText}
      L’annulation (Ctrl+Z) est désactivée en édition partagée.
    </p>
    {#if confirmLeave}
      <p class="small">Votre copie restera sur cet appareil mais ne recevra plus les modifications des autres.</p>
      <div class="foot start">
        <button class="btn sm" onclick={() => (confirmLeave = false)}>Garder la synchro</button>
        <button class="btn sm pri danger-bg" onclick={leave}>Arrêter la synchro</button>
      </div>
    {:else}
      <div class="foot start"><button class="btn sm danger" onclick={() => (confirmLeave = true)}>Arrêter la synchro sur cet appareil</button></div>
    {/if}
  {:else}
    <p class="small">Créez un lien : chaque personne qui l’ouvre voit et modifie la même liste, en temps réel.</p>
    <div class="foot start">
      <button class="btn pri" disabled={busy} onclick={start}>
        {#if sent && sent.total}Envoi des images… {sent.done}/{sent.total}{:else if busy}Création…{:else}Créer le lien partagé{/if}
      </button>
    </div>
  {/if}

  <h3 class="msub">Publier dans la communauté</h3>
  <p class="small">
    {#if pub}
      Publiée : tout le monde la voit dans l’onglet Communauté et peut en faire sa version. Vos modifications n’y apparaissent qu’après « Mettre à jour ».
    {:else}
      Une copie figée de la liste devient visible par tous, sans compte. Vous pourrez la mettre à jour ou la retirer depuis cet appareil.
    {/if}
  </p>
  <label for="shAuthor">Pseudo affiché (facultatif)</label>
  <div class="linkrow">
    <input id="shAuthor" type="text" maxlength={COMMUNITY.author} placeholder="Anonyme" bind:value={author} />
    <button class="btn" class:pri={!pub} disabled={pubBusy} onclick={sendPub}><Icon name="globe" />{pub ? 'Mettre à jour' : 'Publier'}</button>
  </div>
  {#if pub}
    <div class="foot start">
      <a class="btn sm" href="#{communityPath(pub.id)}" onclick={onclose}>Voir la publication</a>
      {#if confirmUnpub}
        <button class="btn sm" onclick={() => (confirmUnpub = false)}>Garder</button>
        <button class="btn sm pri danger-bg" disabled={pubBusy} onclick={unpub}>Retirer de la communauté</button>
      {:else}
        <button class="btn sm danger" disabled={pubBusy} onclick={() => (confirmUnpub = true)}>Retirer…</button>
      {/if}
    </div>
  {/if}

  <h3 class="msub">Code de la liste</h3>
  <label for="shOut">Copie figée à envoyer, à ouvrir avec « Importer un code » dans la bibliothèque</label>
  <textarea bind:this={out} id="shOut" readonly value={code || 'Préparation…'}></textarea>
  <div class="foot">
    <button class="btn" onclick={onclose}>Fermer</button>
    <button class="btn" disabled={!code} onclick={() => copy(code, out, 'Code copié')}>Copier le code</button>
  </div>
</Modal>
