import { LIMITS, TILE_COLORS } from './constants';
import { saveList } from './db';
import { shrink } from './images';
import { toast } from './toast.svelte';
import type { Item, ItemDraft, Tier, TierList } from './types';
import { fgFor, uid } from './utils';

export const POOL = 'pool';

interface Snap {
  title: string;
  tiers: Tier[];
  pool: string[];
}

/**
 * État réactif d'une tier liste ouverte.
 * - title / tiers / pool : structure, versionnée par l'historique (instantanés JSON)
 * - items : vignettes immuables ; modifier une vignette en crée une nouvelle, ce qui garde l'annulation simple
 * Toute mutation appelle touch(), qui sauvegarde dans IndexedDB après 400 ms d'inactivité.
 */
export class Editor {
  readonly id: string;
  readonly createdAt: number;

  title = $state('');
  tiers = $state<Tier[]>([]);
  pool = $state<string[]>([]);
  items = $state.raw<Record<string, Item>>({});

  selId = $state<string | null>(null);
  textColor = $state('mix');

  /** État du glisser-déposer, lu par les composants pour l'affichage. */
  dragId = $state<string | null>(null);
  overZone = $state<string | null>(null);
  overTrash = $state(false);

  #hist = $state.raw<string[]>([]);
  canUndo = $derived(this.#hist.length > 0);

  #dirty = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: string | null = null;
  #saving: Promise<void> = Promise.resolve();
  #rot = 0;

  constructor(list: TierList, items: Item[]) {
    this.id = list.id;
    this.createdAt = list.createdAt;
    this.title = list.title;
    this.tiers = list.tiers;
    this.pool = list.pool;
    this.items = Object.fromEntries(items.map((i) => [i.id, i]));
  }

  /* ---------- historique ---------- */

  snap(): string {
    return JSON.stringify({ title: this.title, tiers: this.tiers, pool: this.pool } satisfies Snap);
  }
  #restore(s: string) {
    const d = JSON.parse(s) as Snap;
    this.title = d.title;
    this.tiers = d.tiers;
    this.pool = d.pool;
  }
  pushHistory(s: string) {
    const h = [...this.#hist, s];
    if (h.length > LIMITS.history) h.shift();
    this.#hist = h;
  }
  commit() {
    this.pushHistory(this.snap());
  }
  undo(): boolean {
    const h = this.#hist;
    if (!h.length) return false;
    this.#restore(h[h.length - 1]);
    this.#hist = h.slice(0, -1);
    if (this.selId && !this.where(this.selId).list) this.selId = null;
    this.touch();
    return true;
  }
  /** Revient à un instantané sans l'ajouter à l'historique (drag annulé). */
  revert(s: string) {
    this.#restore(s);
    this.touch();
  }
  /** Saisie continue (titre, nom de rang) : un seul pas d'historique par session d'édition. */
  beginEdit() {
    this.#pending = this.snap();
  }
  endEdit() {
    if (this.#pending && this.#pending !== this.snap()) this.pushHistory(this.#pending);
    this.#pending = null;
    this.touch();
  }

  /* ---------- requêtes ---------- */

  lists(): string[][] {
    return [this.pool, ...this.tiers.map((t) => t.items)];
  }
  usedIds(): string[] {
    return this.lists().flat();
  }
  where(id: string): { list: string[] | null; index: number } {
    for (const list of this.lists()) {
      const index = list.indexOf(id);
      if (index > -1) return { list, index };
    }
    return { list: null, index: -1 };
  }
  listOf(zone: string | null | undefined): string[] {
    if (!zone || zone === POOL) return this.pool;
    return this.tiers.find((t) => t.id === zone)?.items ?? this.pool;
  }
  tierIndexOf(id: string): number {
    return this.tiers.findIndex((t) => t.items.includes(id));
  }
  /** Vrai quand la réserve vient d'être vidée dans des rangs. */
  isDone(poolBefore: number): boolean {
    return poolBefore > 0 && !this.pool.length && this.tiers.some((t) => t.items.length > 0);
  }

  /* ---------- vignettes ---------- */

  #add(it: Item) {
    this.items = { ...this.items, [it.id]: it };
    this.#dirty.add(it.id);
  }

  /** Classe une vignette ; renvoie true si la liste vient d'être terminée. */
  moveTo(id: string, zone: string): boolean {
    const { list, index } = this.where(id);
    if (!list) return false;
    const before = this.pool.length;
    const fromPool = list === this.pool;
    this.commit();
    list.splice(index, 1);
    this.listOf(zone).push(id);
    // depuis la réserve : la sélection passe à la vignette suivante pour enchaîner au clavier
    this.selId = fromPool && zone !== POOL ? (this.pool[index] ?? this.pool[this.pool.length - 1] ?? null) : null;
    this.touch();
    return this.isDone(before);
  }

  remove(id: string) {
    if (!this.where(id).list) return;
    this.commit();
    this.discard(id);
  }
  /** Retire sans créer de pas d'historique (l'appelant s'en charge). */
  discard(id: string) {
    const { list, index } = this.where(id);
    if (!list) return;
    list.splice(index, 1);
    if (this.selId === id) this.selId = list === this.pool ? (this.pool[index] ?? null) : null;
    this.touch();
  }

  /** Ajoute une ou plusieurs vignettes texte (séparées par virgule, point-virgule ou retour ligne). */
  addTexts(str: string, zone = POOL): number {
    const parts = String(str)
      .split(/[\n,;]+/)
      .map((s) => s.trim().slice(0, LIMITS.tileText))
      .filter(Boolean)
      .slice(0, 100);
    if (!parts.length) return 0;
    this.commit();
    const target = this.listOf(zone);
    for (const text of parts) {
      const bg = this.textColor === 'mix' ? TILE_COLORS[this.#rot++ % TILE_COLORS.length] : this.textColor;
      const it: Item = { id: uid(), listId: this.id, type: 'text', text, bg, fg: fgFor(bg) };
      this.#add(it);
      target.push(it.id);
    }
    this.touch();
    return parts.length;
  }

  /** Importe des images (réduites à 320 px). Renvoie les ids créés. */
  async addImages(files: Iterable<File>, zone = POOL): Promise<string[]> {
    const fs = [...files].filter((f) => f.type.startsWith('image/')).slice(0, LIMITS.importImages);
    if (!fs.length) return [];
    const before = this.snap();
    const added: string[] = [];
    for (const f of fs) {
      try {
        const blob = await shrink(f);
        const it: Item = { id: uid(), listId: this.id, type: 'img', text: '', blob };
        this.#add(it);
        this.listOf(zone).push(it.id);
        added.push(it.id);
      } catch {
        /* fichier ignoré */
      }
    }
    if (added.length) {
      this.pushHistory(before);
      this.touch();
    }
    return added;
  }

  replaceItem(id: string, draft: ItemDraft) {
    const { list, index } = this.where(id);
    this.commit();
    const it: Item = { ...draft, id: uid(), listId: this.id };
    this.#add(it);
    if (list) list[index] = it.id;
    this.selId = it.id;
    this.touch();
  }

  duplicateItem(id: string, draft: ItemDraft) {
    const { list, index } = this.where(id);
    this.commit();
    const it: Item = { ...draft, id: uid(), listId: this.id };
    this.#add(it);
    if (list) list.splice(index + 1, 0, it.id);
    this.touch();
  }

  /* ---------- rangs ---------- */

  addTier(at = this.tiers.length): string {
    this.commit();
    const t: Tier = { id: uid(), name: 'Nouveau', color: '#d0d0d0', items: [] };
    this.tiers.splice(at, 0, t);
    this.touch();
    return t.id;
  }
  moveTier(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= this.tiers.length) return;
    this.commit();
    const [t] = this.tiers.splice(i, 1);
    this.tiers.splice(j, 0, t);
    this.touch();
  }
  updateTier(id: string, name: string, color: string) {
    const t = this.tiers.find((x) => x.id === id);
    if (!t) return;
    this.commit();
    t.name = name.trim().slice(0, LIMITS.tierName) || t.name;
    t.color = color;
    this.touch();
  }
  /** Renommage en direct (entre beginEdit et endEdit). */
  renameTierLive(id: string, name: string) {
    const t = this.tiers.find((x) => x.id === id);
    if (t) t.name = name;
    this.touch();
  }
  clearTier(id: string) {
    const t = this.tiers.find((x) => x.id === id);
    if (!t) return;
    this.commit();
    this.pool.push(...t.items);
    t.items = [];
    this.touch();
  }
  deleteTier(id: string) {
    const i = this.tiers.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.commit();
    this.pool.push(...this.tiers[i].items);
    this.tiers.splice(i, 1);
    this.touch();
  }
  /** Remet toutes les vignettes en réserve. false si les rangs étaient déjà vides. */
  resetAll(): boolean {
    const all = this.tiers.flatMap((t) => t.items);
    if (!all.length) return false;
    this.commit();
    this.pool.push(...all);
    for (const t of this.tiers) t.items = [];
    this.touch();
    return true;
  }

  setTitleLive(v: string) {
    this.title = v.slice(0, LIMITS.title);
    this.touch();
  }

  /* ---------- glisser-déposer ---------- */

  /** Place la vignette à l'index donné (index compté sans la vignette déplacée). */
  placeLive(id: string, zone: string, index: number) {
    const { list, index: cur } = this.where(id);
    if (!list) return;
    const target = this.listOf(zone);
    if (list === target && cur === index) return;
    list.splice(cur, 1);
    target.splice(Math.min(index, target.length), 0, id);
  }

  /* ---------- sauvegarde ---------- */

  touch() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const list: TierList = {
      id: this.id,
      title: this.title,
      tiers: $state.snapshot(this.tiers),
      pool: $state.snapshot(this.pool),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    };
    const dirty = [...this.#dirty].map((id) => this.items[id]).filter(Boolean);
    this.#dirty.clear();
    this.#saving = this.#saving
      .then(() => saveList(list, dirty))
      .catch(() => {
        dirty.forEach((i) => this.#dirty.add(i.id));
        toast('Sauvegarde impossible (stockage plein ou bloqué)');
      });
    return this.#saving;
  }
}
