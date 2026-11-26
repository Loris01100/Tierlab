import { applyOp, POOL, type LiveItem, type Op, type Structure } from '../../shared/live';
import { LIMITS, TILE_COLORS } from './constants';
import { saveList } from './db';
import { shrink } from './images';
import { fromLive, LiveLink, toLive } from './live.svelte';
import { toast } from './toast.svelte';
import type { Item, ItemDraft, Tier, TierList } from './types';
import { fgFor, uid } from './utils';

export { POOL };

interface Snap {
  title: string;
  tiers: Tier[];
  pool: string[];
}

/**
 * État réactif d'une tier liste ouverte.
 * - title / tiers / pool : structure, versionnée par l'historique (instantanés JSON)
 * - items : vignettes immuables ; modifier une vignette en crée une nouvelle, ce qui garde l'annulation simple
 * Toute mutation passe par une opération (shared/live.ts) appliquée par #run, qui appelle touch() :
 * sauvegarde dans IndexedDB après 400 ms d'inactivité. En édition partagée (live), l'opération part aussi au serveur.
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

  /** Lien d'édition partagée, null pour une liste seulement locale. */
  live = $state.raw<LiveLink | null>(null);

  #hist = $state.raw<string[]>([]);
  canUndo = $derived(this.#hist.length > 0);

  #dirty = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: string | null = null;
  #saving: Promise<void> = Promise.resolve();
  #rot = 0;
  #room: string | undefined;
  /** Dernière place provisoire pendant un glisser, réappliquée si un autre client modifie la liste. */
  #dragAt: { id: string; zone: string; index: number } | null = null;

  constructor(list: TierList, items: Item[]) {
    this.id = list.id;
    this.createdAt = list.createdAt;
    this.title = list.title;
    this.tiers = list.tiers;
    this.pool = list.pool;
    this.items = Object.fromEntries(items.map((i) => [i.id, i]));
    if (list.live) {
      this.#room = list.live;
      this.live = new LiveLink(this, list.live, list.livePending);
    }
  }

  /* ---------- historique ---------- */

  snapshot(): string {
    return JSON.stringify({ title: this.title, tiers: this.tiers, pool: this.pool } satisfies Snap);
  }
  #restore(s: string) {
    const d = JSON.parse(s) as Snap;
    this.title = d.title;
    this.tiers = d.tiers;
    this.pool = d.pool;
  }
  pushHistory(s: string) {
    // En édition partagée, restaurer un instantané écraserait les modifications des autres.
    if (this.live) return;
    const h = [...this.#hist, s];
    if (h.length > LIMITS.history) h.shift();
    this.#hist = h;
  }
  commit() {
    this.pushHistory(this.snapshot());
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
    this.#dragAt = null;
    if (this.live) return this.live.refresh();
    this.#restore(s);
    this.touch();
  }
  /** Saisie continue (titre, nom de rang) : un seul pas d'historique par session d'édition. */
  beginEdit() {
    this.#pending = this.snapshot();
  }
  endEdit() {
    // Fin de saisie : la dernière valeur part tout de suite, sans attendre la pause de frappe.
    this.live?.release();
    if (this.#pending && this.#pending !== this.snapshot()) this.pushHistory(this.#pending);
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

  /** Ajoute des vignettes en une seule copie de `items` (pas une par vignette : un import de 200 resterait linéaire). */
  #addItems(...its: Item[]) {
    this.items = { ...this.items, ...Object.fromEntries(its.map((it) => [it.id, it])) };
    for (const it of its) this.#dirty.add(it.id);
  }

  /**
   * Applique une opération à l'état local, la transmet en édition partagée, puis programme la sauvegarde.
   * hold : saisie continue (titre, nom de rang) ; l'envoi attend une pause de frappe et les frappes successives fusionnent.
   */
  #run(op: Op, hold = false) {
    applyOp(this, op);
    this.live?.send(op, hold);
    this.touch();
  }

  /** Zone (POOL ou id de rang) contenant la vignette, null si elle n'est pas placée. */
  zoneOf(id: string): string | null {
    if (this.pool.includes(id)) return POOL;
    return this.tiers.find((t) => t.items.includes(id))?.id ?? null;
  }

  /** Classe une vignette ; renvoie true si la liste vient d'être terminée. */
  moveTo(id: string, zone: string): boolean {
    const { list, index } = this.where(id);
    if (!list) return false;
    const fromPool = list === this.pool;
    // Déjà en dernière place de cette zone : rien ne bouge, donc ni étape d'annulation ni opération envoyée.
    if (list === this.listOf(zone) && index === list.length - 1) {
      this.selId = null;
      return false;
    }
    const before = this.pool.length;
    this.commit();
    this.#run({ k: 'move', id, zone });
    // depuis la réserve : la sélection passe à la vignette suivante pour enchaîner au clavier
    this.selId = fromPool && zone !== POOL ? (this.pool[index] ?? this.pool[this.pool.length - 1] ?? null) : null;
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
    const inPool = list === this.pool;
    this.#run({ k: 'remove', id });
    if (this.selId === id) this.selId = inPool ? (this.pool[index] ?? null) : null;
  }

  /** Ajoute des vignettes neuves à une zone, en une seule étape d'annulation. */
  #addAll(items: Item[], zone: string) {
    this.commit();
    this.#addItems(...items);
    this.#run({ k: 'add', zone, items: items.map(toLive) });
  }

  #textItem(text: string, bg: string): Item {
    return { id: uid(), listId: this.id, type: 'text', text, bg, fg: fgFor(bg) };
  }
  #nextColor(): string {
    return TILE_COLORS[this.#rot++ % TILE_COLORS.length];
  }

  /** Ajoute une ou plusieurs vignettes texte (séparées par virgule, point-virgule ou retour ligne). */
  addTexts(str: string, zone = POOL): number {
    const parts = String(str)
      .split(/[\n,;]+/)
      .map((s) => s.trim().slice(0, LIMITS.tileText))
      .filter(Boolean)
      .slice(0, 100);
    if (!parts.length) return 0;
    this.#addAll(
      parts.map((text) => this.#textItem(text, this.textColor === 'mix' ? this.#nextColor() : this.textColor)),
      zone,
    );
    return parts.length;
  }

  /** Importe des images (réduites à 320 px). Renvoie les ids créés. */
  async addImages(files: Iterable<File>, zone = POOL): Promise<string[]> {
    const fs = [...files].filter((f) => f.type.startsWith('image/')).slice(0, LIMITS.importImages);
    const items: Item[] = [];
    for (const f of fs) {
      try {
        items.push({ id: uid(), listId: this.id, type: 'img', text: '', blob: await shrink(f) });
      } catch {
        /* fichier ignoré */
      }
    }
    if (items.length) this.#addAll(items, zone);
    return items.map((i) => i.id);
  }

  /**
   * Ajoute des vignettes venant d'une source externe (API) : image + légende, ou texte seul sans image.
   * Les images doivent déjà être réduites. Une seule étape d'annulation pour tout le lot.
   */
  addEntries(entries: { text: string; blob?: Blob }[], zone = POOL): string[] {
    if (!entries.length) return [];
    const items = entries.map((e): Item => {
      const text = e.text.trim().slice(0, LIMITS.tileText);
      return e.blob ? { id: uid(), listId: this.id, type: 'img', text, blob: e.blob } : this.#textItem(text || '?', this.#nextColor());
    });
    this.#addAll(items, zone);
    return items.map((i) => i.id);
  }

  replaceItem(id: string, draft: ItemDraft) {
    this.commit();
    const it: Item = { ...draft, id: uid(), listId: this.id };
    this.#addItems(it);
    this.#run({ k: 'replace', id, item: toLive(it) });
    this.selId = it.id;
  }

  duplicateItem(id: string, draft: ItemDraft) {
    this.commit();
    const it: Item = { ...draft, id: uid(), listId: this.id };
    this.#addItems(it);
    this.#run({ k: 'dup', id, item: toLive(it) });
  }

  /** Image d'une vignette reçue en édition partagée (téléchargée après coup). */
  setBlob(id: string, blob: Blob) {
    const it = this.items[id];
    if (!it || it.blob) return;
    this.items = { ...this.items, [id]: { ...it, blob } };
    this.#dirty.add(id);
    this.touch();
  }

  /* ---------- rangs ---------- */

  addTier(at = this.tiers.length): string {
    this.commit();
    const tier = { id: uid(), name: 'Nouveau', color: '#d0d0d0' };
    this.#run({ k: 'tierAdd', at, tier });
    return tier.id;
  }
  moveTier(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= this.tiers.length) return;
    this.commit();
    this.#run({ k: 'tierMove', id: this.tiers[i].id, to: j });
  }
  updateTier(id: string, name: string, color: string) {
    const t = this.tiers.find((x) => x.id === id);
    if (!t) return;
    this.commit();
    this.#run({ k: 'tierSet', id, name: name.trim().slice(0, LIMITS.tierName) || t.name, color });
  }
  /** Renommage en direct (entre beginEdit et endEdit). */
  renameTierLive(id: string, name: string) {
    if (this.tiers.some((x) => x.id === id)) this.#run({ k: 'tierSet', id, name }, true);
  }
  clearTier(id: string) {
    if (!this.tiers.some((x) => x.id === id)) return;
    this.commit();
    this.#run({ k: 'tierClear', id });
  }
  deleteTier(id: string) {
    if (!this.tiers.some((x) => x.id === id)) return;
    this.commit();
    this.#run({ k: 'tierDelete', id });
  }
  /** Remet toutes les vignettes en réserve. false si les rangs étaient déjà vides. */
  resetAll(): boolean {
    if (!this.tiers.some((t) => t.items.length)) return false;
    this.commit();
    this.#run({ k: 'reset' });
    return true;
  }

  setTitleLive(v: string) {
    this.#run({ k: 'title', title: v.slice(0, LIMITS.title) }, true);
  }

  /* ---------- glisser-déposer ---------- */

  /** Place la vignette à l'index donné (index compté sans la vignette déplacée). Local seulement, jusqu'au lâcher. */
  placeLive(id: string, zone: string, index: number) {
    this.#dragAt = { id, zone, index };
    this.#place(id, zone, index);
  }
  #place(id: string, zone: string, index: number) {
    const { list, index: cur } = this.where(id);
    if (!list) return;
    const target = this.listOf(zone);
    if (list === target && cur === index) return;
    list.splice(cur, 1);
    target.splice(Math.min(index, target.length), 0, id);
  }

  /** Fin d'un glisser réussi : un pas d'historique et, en édition partagée, la place finale envoyée aux autres. */
  dropped(id: string, before: string) {
    this.#dragAt = null;
    this.pushHistory(before);
    const zone = this.zoneOf(id);
    if (zone) this.#run({ k: 'move', id, zone, at: this.where(id).index });
    else this.touch();
  }

  /* ---------- édition partagée ---------- */

  /** Relie la liste à une salle partagée (l'historique local est abandonné : l'annulation y est désactivée). */
  goLive(room: string) {
    this.live?.close();
    this.#room = room;
    this.#hist = [];
    this.live = new LiveLink(this, room);
    void this.flush();
  }

  /** Arrête la synchronisation : la liste redevient une copie locale indépendante. */
  leaveLive() {
    this.live?.close();
    this.live = null;
    this.#room = undefined;
    void this.flush();
  }

  /** Structure actuelle, hors réactivité (clonable). */
  structure(): Structure {
    return { title: this.title, tiers: $state.snapshot(this.tiers), pool: $state.snapshot(this.pool) };
  }

  /**
   * Remplace la structure par celle calculée par le lien partagé (état du serveur + nos opérations en attente)
   * et ajoute les vignettes reçues. Un glisser en cours garde sa place provisoire.
   */
  adopt(s: Structure, incoming: LiveItem[]) {
    this.title = s.title;
    this.tiers = s.tiers;
    this.pool = s.pool;
    const add = incoming.filter((i) => !this.items[i.id]);
    if (add.length) {
      this.items = { ...this.items, ...Object.fromEntries(add.map((i) => [i.id, fromLive(i, this.id)])) };
      for (const i of add) this.#dirty.add(i.id);
    }
    const d = this.#dragAt;
    if (d && this.dragId === d.id) this.#place(d.id, d.zone, d.index);
    if (this.selId && !this.where(this.selId).list) this.selId = null;
    this.touch();
  }

  /* ---------- sauvegarde ---------- */

  touch() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const pending = this.live?.pendingOps() ?? [];
    const list: TierList = {
      id: this.id,
      title: this.title,
      tiers: $state.snapshot(this.tiers),
      pool: $state.snapshot(this.pool),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      ...(this.#room ? { live: this.#room } : {}),
      // Sans elles, la copie locale serait écrasée par l'état du serveur à la prochaine ouverture (modifications perdues).
      ...(pending.length ? { livePending: $state.snapshot(pending) } : {}),
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
