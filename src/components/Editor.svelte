<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { pendingCatalog, type CatalogTab } from '../lib/catalog';
  import { PARTY } from '../lib/constants';
  import { attachDrag } from '../lib/drag';
  import { POOL, type Editor } from '../lib/editor.svelte';
  import { burst, burstAt, poof, rain, SPRING } from '../lib/effects';
  import { renderTierList } from '../lib/exportImage';
  import { go } from '../lib/router.svelte';
  import { toast } from '../lib/toast.svelte';
  import { isTyping, plural, pref, reducedMotion, setPref } from '../lib/utils';
  import Dock from './Dock.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import CatalogModal from './modals/CatalogModal.svelte';
  import ExportModal from './modals/ExportModal.svelte';
  import RowModal from './modals/RowModal.svelte';
  import ShareModal from './modals/ShareModal.svelte';
  import TileModal from './modals/TileModal.svelte';
  import Row from './Row.svelte';

  let { ed }: { ed: Editor } = $props();

  type ModalState =
    | { kind: 'row'; id: string }
    | { kind: 'tile'; id: string }
    | { kind: 'share' }
    | { kind: 'catalog'; tab?: CatalogTab }
    | { kind: 'export'; blob: Blob }
    | null;
  let modal = $state<ModalState>(null);

  // Liste créée depuis un raccourci « Démarrer vite » : on ouvre directement le bon catalogue.
  if (pendingCatalog.tab) {
    modal = { kind: 'catalog', tab: pendingCatalog.tab };
    pendingCatalog.tab = null;
  }

  /* ---------- taille des vignettes (préférence locale) ---------- */
  let size = $state(pref('tierlab-size', innerWidth < 600 ? 64 : 84));
  $effect(() => {
    document.documentElement.style.setProperty('--t', size + 'px');
    setPref('tierlab-size', size);
  });

  /* ---------- animation d'entrée ---------- */
  let intro = $state(!reducedMotion());
  onMount(() => {
    const t = setTimeout(() => (intro = false), 1800);
    return () => clearTimeout(t);
  });

  /* ---------- effets ---------- */
  const tileEl = (id: string) => document.querySelector<HTMLElement>(`main .tile[data-id="${CSS.escape(id)}"]`);

  async function landFx(id: string, delay = 0) {
    await tick();
    setTimeout(() => {
      const el = tileEl(id);
      if (!el) return;
      const ti = ed.tierIndexOf(id);
      if (!reducedMotion())
        el.animate(
          [{ transform: 'scale(1.3) rotate(-6deg)' }, { transform: 'scale(.88) rotate(2deg)' }, { transform: 'scale(1.05)' }, { transform: 'none' }],
          { duration: 450, easing: 'ease-out' },
        );
      if (ti < 0) return;
      const c = ed.tiers[ti].color;
      const top = ti === 0;
      burstAt(el, [c, c, '#ffffff', top ? '#ffd700' : c], top ? 46 : 20, top ? 1.4 : 0.9);
      if (top && !reducedMotion())
        document
          .querySelector(`.lab[data-t="${ed.tiers[0].id}"]`)
          ?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18) rotate(-4deg)' }, { transform: 'none' }], { duration: 500, easing: SPRING });
    }, delay);
  }
  function celebrate(done: boolean) {
    if (!done) return;
    setTimeout(rain, 380);
    toast('Tier liste terminée, bravo !');
  }

  /* ---------- actions ---------- */
  function place(id: string, zone: string) {
    const done = ed.moveTo(id, zone);
    landFx(id, reducedMotion() ? 0 : 230);
    celebrate(done);
  }
  function delSel() {
    if (!ed.selId) return;
    poof(tileEl(ed.selId));
    ed.remove(ed.selId);
    toast(deletedMsg());
  }
  function undo() {
    if (ed.undo()) toast('Action annulée');
    else if (ed.live) toast('Annulation indisponible en édition partagée');
  }
  const deletedMsg = () => (ed.live ? 'Vignette supprimée' : 'Vignette supprimée (Ctrl+Z pour annuler)');

  /* ---------- édition partagée ---------- */
  const liveLabel = $derived.by(() => {
    const l = ed.live;
    if (!l) return '';
    if (l.status === 'online') return `${l.peers} en ligne`;
    return l.status === 'gone' ? 'Lien expiré' : l.status === 'offline' ? 'Hors ligne' : 'Connexion…';
  });
  async function importFiles(files: Iterable<File>, zone = POOL) {
    const added = await ed.addImages(files, zone);
    toast(added.length ? `${plural(added.length, 'image')} ajoutée${added.length > 1 ? 's' : ''}` : 'Aucune image reconnue');
    if (added.length === 1) {
      ed.selId = added[0];
      modal = { kind: 'tile', id: added[0] };
    }
  }
  function addTexts(str: string, zone = POOL) {
    const n = ed.addTexts(str, zone);
    if (n) toast(`${plural(n, 'vignette')} ajoutée${n > 1 ? 's' : ''}`);
  }
  async function focusLab(id: string) {
    await tick();
    const l = document.querySelector<HTMLElement>(`.lab[data-t="${id}"]`);
    if (l) {
      l.focus();
      getSelection()?.selectAllChildren(l);
    }
  }
  async function exportImage(btn: HTMLElement) {
    toast('Création de l’image…');
    const c = await renderTierList(ed.title, ed.tiers, ed.items);
    c.toBlob((b) => {
      if (!b) return toast('Export impossible');
      burstAt(btn, PARTY, 36, 1.1);
      modal = { kind: 'export', blob: b };
    }, 'image/png');
  }

  /* ---------- défi 5 minutes ---------- */
  let chronoEnd = $state(0);
  let now = $state(Date.now());
  let chronoTimer: ReturnType<typeof setInterval> | undefined;
  let chronoLate = $state(false);
  const left = $derived(Math.max(0, chronoEnd - now));
  const secs = $derived(Math.ceil(left / 1000));
  function toggleChrono() {
    clearInterval(chronoTimer);
    chronoLate = false;
    if (chronoEnd) {
      chronoEnd = 0;
      return;
    }
    chronoEnd = Date.now() + 5 * 60_000;
    now = Date.now();
    chronoTimer = setInterval(() => {
      now = Date.now();
      if (now >= chronoEnd) {
        clearInterval(chronoTimer);
        chronoEnd = 0;
        chronoLate = true;
        toast('5 minutes écoulées !');
        rain();
      }
    }, 250);
  }

  /* ---------- glisser-déposer, sauvegarde à la fermeture ---------- */
  onMount(() => {
    const detach = attachDrag(ed, {
      blocked: () => modal !== null,
      landed: (id, done) => {
        landFx(id);
        celebrate(done);
      },
      trashed: (g) => {
        const tr = document.querySelector<HTMLElement>('.trash')!;
        const b = tr.getBoundingClientRect();
        const an = g.animate(
          [
            { transform: g.style.transform },
            { transform: `translate(${b.left + b.width / 2 - g.offsetWidth / 2}px,${b.top + b.height / 2 - g.offsetHeight / 2}px) rotate(540deg) scale(0)`, opacity: 0.2 },
          ],
          { duration: reducedMotion() ? 1 : 420, easing: 'cubic-bezier(.5,0,.8,.4)' },
        );
        an.onfinish = () => {
          g.remove();
          burst(b.left + b.width / 2, b.top + b.height / 2, ['#e5484d', '#9aa0ad', '#ffffff'], 22, 0.9);
          tr.classList.remove('gulp');
          void tr.offsetWidth;
          tr.classList.add('gulp');
        };
        toast(deletedMsg());
      },
    });
    const hide = () => document.visibilityState === 'hidden' && void ed.flush();
    document.addEventListener('visibilitychange', hide);
    return () => {
      detach();
      document.removeEventListener('visibilitychange', hide);
      clearInterval(chronoTimer);
      void ed.flush();
    };
  });

  /* ---------- clavier, collage, fichiers déposés ---------- */
  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || modal) return;
    const a = document.activeElement as HTMLElement | null;
    const typing = isTyping(a);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (a?.classList.contains('tile') && (e.key === ' ' || e.key === 'Enter') && ed.selId !== a.dataset.id) {
      e.preventDefault();
      ed.selId = a.dataset.id ?? null;
      return;
    }
    const sel = ed.selId;
    if (!sel) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const n = +e.key;
      if (n === 0) place(sel, POOL);
      else if (ed.tiers[n - 1]) place(sel, ed.tiers[n - 1].id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      delSel();
    } else if (e.key === 'Enter' || e.key.toLowerCase() === 'e') {
      e.preventDefault();
      modal = { kind: 'tile', id: sel };
    } else if (e.key === 'Escape') ed.selId = null;
  }

  function onpaste(e: ClipboardEvent) {
    if (modal || !e.clipboardData) return;
    const a = document.activeElement as HTMLElement | null;
    const fs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (fs.length && !a?.isContentEditable) {
      e.preventDefault();
      importFiles(fs);
      return;
    }
    if (isTyping(a)) return;
    const t = e.clipboardData.getData('text/plain');
    if (t.trim()) {
      e.preventDefault();
      addTexts(t);
    }
  }

  let dropShown = $state(false);
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const zoneAt = (t: EventTarget | null) => {
    const el = t instanceof Element ? t : null;
    const z = el?.closest<HTMLElement>('.zone') ?? el?.closest('.row')?.querySelector<HTMLElement>('.zone');
    return z?.dataset.zone ?? POOL;
  };

  // clic sur une vignette sélectionnée puis sur un rang : classement sans glisser
  function onclick(e: MouseEvent) {
    const t = e.target as Element;
    if (!ed.selId || modal || t.closest('.tile') || !t.closest('main')) return;
    const z = t.closest<HTMLElement>('.zone');
    if (z?.dataset.zone) place(ed.selId, z.dataset.zone);
  }
  function ondblclick(e: MouseEvent) {
    const t = (e.target as Element).closest<HTMLElement>('main .tile[data-id]');
    if (!t || modal) return;
    ed.selId = t.dataset.id!;
    modal = { kind: 'tile', id: ed.selId };
  }
</script>

<svelte:window {onkeydown} />
<svelte:document
  {onpaste}
  {onclick}
  {ondblclick}
  ondragstart={(e) => e.preventDefault()}
  ondragover={(e) => {
    e.preventDefault();
    if (!hasFiles(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return;
    }
    dropShown = true;
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (dropShown = false), 180);
  }}
  ondrop={(e) => {
    e.preventDefault();
    dropShown = false;
    if (modal || !e.dataTransfer?.files.length) return;
    importFiles(e.dataTransfer.files, zoneAt(e.target));
  }}
/>

<header class="top">
  <button class="brand" onclick={() => go('/')} title="Mes tier listes">
    <Logo />
  </button>
  <input
    class="title-in"
    type="text"
    aria-label="Titre de la tier liste"
    maxlength="80"
    placeholder="Titre de la tier liste"
    value={ed.title}
    onfocus={() => ed.beginEdit()}
    oninput={(e) => ed.setTitleLive(e.currentTarget.value)}
    onblur={() => ed.endEdit()}
    onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
  />
  <div class="acts">
    <button class="btn" onclick={() => go('/')} aria-label="Mes tier listes"><Icon name="grid" /><span>Mes listes</span></button>
    <button
      class="btn"
      title={ed.live ? 'Annulation indisponible en édition partagée' : 'Annuler (Ctrl+Z)'}
      aria-label="Annuler"
      disabled={!ed.canUndo}
      onclick={undo}><Icon name="undo" /><span>Annuler</span></button
    >
    {#if ed.live}
      <!-- liste partagée : la pastille d'état remplace le bouton Partager et ouvre la même fenêtre -->
      <button class="btn live" data-s={ed.live.status} title="Édition partagée : {liveLabel}" aria-label="Partager (édition partagée, {liveLabel})" onclick={() => (modal = { kind: 'share' })}
        ><Icon name="users" /><span>{liveLabel}</span></button
      >
    {:else}
      <button class="btn" aria-label="Partager" onclick={() => (modal = { kind: 'share' })}><Icon name="users" /><span>Partager</span></button>
    {/if}
    <button class="btn pri" aria-label="Exporter en image" onclick={(e) => exportImage(e.currentTarget)}><Icon name="dl" /><span>Exporter en image</span></button>
  </div>
</header>

<main>
  <div class="bar">
    <button class="btn" class:run={!!chronoEnd} class:hurry={!!chronoEnd && secs <= 30} class:late={chronoLate} title="Compte à rebours de 5 minutes" onclick={toggleChrono}>
      <Icon name="timer" /><span
        >{chronoEnd ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : chronoLate ? 'Temps écoulé' : 'Défi 5 min'}</span
      >
    </button>
    <label class="sz">Taille des vignettes <input type="range" min="48" max="128" step="4" bind:value={size} /></label>
    <button class="btn" onclick={() => (ed.resetAll() ? toast('Toutes les vignettes sont dans la réserve') : toast('Les rangs sont déjà vides'))}>
      Tout remettre en réserve
    </button>
  </div>

  <div class="board" class:intro aria-label="Tier liste">
    {#each ed.tiers as tier, i (tier.id)}
      <div class="rowwrap" animate:flip={{ duration: reducedMotion() ? 0 : 420, easing: (t) => 1 - Math.pow(1 - t, 3) }}>
        <Row {ed} {tier} index={i} onconfig={(id) => (modal = { kind: 'row', id })} />
      </div>
    {/each}
  </div>
  <button class="btn addrow" onclick={() => focusLab(ed.addTier())}><Icon name="plus" />Ajouter un rang</button>

  <Dock
    {ed}
    onfiles={(f) => importFiles(f)}
    oncatalog={() => (modal = { kind: 'catalog' })}
    ontexts={(t) => addTexts(t)}
    onedit={() => ed.selId && (modal = { kind: 'tile', id: ed.selId })}
    ondelete={delSel}
  />
</main>

{#if dropShown}<div class="dropzone">Déposez vos images</div>{/if}

{#if modal?.kind === 'row'}
  <RowModal {ed} tierId={modal.id} onclose={() => (modal = null)} onadded={focusLab} />
{:else if modal?.kind === 'tile'}
  <TileModal
    {ed}
    itemId={modal.id}
    onclose={() => (modal = null)}
    ondelete={() => {
      modal = null;
      delSel();
    }}
  />
{:else if modal?.kind === 'catalog'}
  <CatalogModal {ed} initial={modal.tab} onclose={() => (modal = null)} />
{:else if modal?.kind === 'share'}
  <ShareModal {ed} onclose={() => (modal = null)} />
{:else if modal?.kind === 'export'}
  <ExportModal blob={modal.blob} filename="{ed.title || 'tier-liste'}.png" onclose={() => (modal = null)} />
{/if}
