import type { Editor } from './editor.svelte';
import { reducedMotion } from './utils';

/**
 * Glisser-déposer souris + tactile par Pointer Events.
 * Pendant le glisser, l'état est modifié en direct (placeLive) : Svelte déplace la vignette
 * et animate:flip anime les voisines. Un fantôme (clone hors Svelte) suit le pointeur.
 */
export interface DragHooks {
  /** Vrai quand une fenêtre est ouverte (glisser désactivé). */
  blocked: () => boolean;
  /** Vignette lâchée à une nouvelle place. */
  landed: (id: string, done: boolean) => void;
  /** Vignette lâchée sur la corbeille ; le fantôme est remis à l'appelant pour l'animation. */
  trashed: (ghost: HTMLElement) => void;
}

interface Drag {
  id: string;
  x: number;
  y: number;
  on: boolean;
  ghost?: HTMLElement;
  dx: number;
  dy: number;
  before: string;
  poolBefore: number;
  lx: number;
  rot: number;
  sc: number;
}

const tileEl = (id: string) => document.querySelector<HTMLElement>(`main .tile[data-id="${CSS.escape(id)}"]`);

export function attachDrag(ed: Editor, hooks: DragHooks): () => void {
  let d: Drag | null = null;

  function start(s: Drag): boolean {
    const el = tileEl(s.id);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const g = el.cloneNode(true) as HTMLElement;
    g.classList.add('ghost');
    g.classList.remove('sel');
    g.removeAttribute('data-id');
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    document.body.appendChild(g);
    Object.assign(s, { on: true, ghost: g, dx: s.x - r.left, dy: s.y - r.top, before: ed.snapshot(), poolBefore: ed.pool.length, lx: s.x });
    ed.dragId = s.id;
    document.body.classList.add('dragging');
    return true;
  }

  function cleanup(s: Drag, keepGhost = false) {
    if (!keepGhost) s.ghost?.remove();
    ed.dragId = null;
    ed.overZone = null;
    ed.overTrash = false;
    document.body.classList.remove('dragging');
  }

  const down = (e: PointerEvent) => {
    if (e.button > 0 || hooks.blocked()) return;
    const t = (e.target as Element).closest<HTMLElement>('main .tile[data-id]');
    if (!t) return;
    d = { id: t.dataset.id!, x: e.clientX, y: e.clientY, on: false, dx: 0, dy: 0, before: '', poolBefore: 0, lx: 0, rot: 0, sc: 1 };
  };

  const move = (e: PointerEvent) => {
    if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      if (!start(d)) {
        d = null;
        return;
      }
    }
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    d.rot = d.rot * 0.75 + Math.max(-24, Math.min(24, (x - d.lx) * 1.6)) * 0.25;
    d.lx = x;
    d.sc += (1.12 - d.sc) * 0.3;
    if (reducedMotion()) d.rot = 0;
    d.ghost!.style.transform = `translate(${x - d.dx}px,${y - d.dy}px) rotate(${d.rot.toFixed(1)}deg) scale(${d.sc.toFixed(3)})`;

    const u = document.elementFromPoint(x, y);
    const trash = !!u?.closest('.trash');
    ed.overTrash = trash;
    const z = u ? (u.closest<HTMLElement>('.zone') ?? u.closest('.row')?.querySelector<HTMLElement>('.zone') ?? null) : null;
    ed.overZone = z && !trash ? (z.dataset.zone ?? null) : null;

    if (z && !trash && z.dataset.zone) {
      // index d'insertion : première vignette située après le pointeur (ordre de lecture)
      let idx = 0;
      for (const t of z.querySelectorAll<HTMLElement>('.tile[data-id]')) {
        if (t.dataset.id === d.id) continue;
        const r = t.getBoundingClientRect();
        if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) break;
        idx++;
      }
      ed.placeLive(d.id, z.dataset.zone, idx);
    }
    if (y < 48) scrollBy(0, -14);
    else if (y > innerHeight - 24) scrollBy(0, 14);
  };

  const up = () => {
    if (!d) return;
    const s = d;
    d = null;
    if (!s.on) {
      // simple clic : sélection
      ed.selId = ed.selId === s.id ? null : s.id;
      return;
    }
    const trash = ed.overTrash;
    cleanup(s, trash);
    if (trash) {
      ed.pushHistory(s.before);
      ed.discard(s.id);
      hooks.trashed(s.ghost!);
      return;
    }
    if (ed.snapshot() !== s.before) {
      ed.dropped(s.id, s.before);
      hooks.landed(s.id, ed.isDone(s.poolBefore));
    }
  };

  const cancel = () => {
    if (d?.on) {
      cleanup(d);
      ed.revert(d.before);
    }
    d = null;
  };

  document.addEventListener('pointerdown', down);
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  return () => {
    cancel();
    document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
  };
}
