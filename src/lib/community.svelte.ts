import { COMMUNITY, type CommunityCard, type CommunityList, type CommunityPage, type CommunitySort, type Published, type PublishBody } from '../../shared/community';
import { ApiError, apiGet, apiPost, apiUrl, mapLimit, RawJson } from './api';
import { saveList } from './db';
import type { Editor } from './editor.svelte';
import { renderThumb } from './exportImage';
import { blobToDataURL } from './images';
import { toShared } from './share';
import { toast } from './toast.svelte';
import type { Item } from './types';
import { fgFor, getPref, plural, setPref, uid } from './utils';

/**
 * Galerie communautaire (serveur : server/gallery.ts). Publier envoie une copie figée de la liste ouverte ;
 * le jeton reçu reste sur cet appareil (localStorage) et permet de mettre à jour ou de retirer la publication.
 */

const KEY = 'tierlab-published';

/** Publications faites depuis cet appareil : id de la liste locale → publication. */
export const published = $state<Record<string, Published>>(getPref(KEY, {}));

const savePublished = () => setPref(KEY, $state.snapshot(published));

/** Id de la liste locale qui a donné cette publication, si elle vient de cet appareil. */
export const ownerOf = (pubId: string): string | undefined => Object.keys(published).find((k) => published[k].id === pubId);

export const communityImageUrl = (id: string, item: string): string => apiUrl(`/community/${id}/img/${item}`);

/** Aperçu de la carte ; ?v= change à chaque mise à jour, l'image peut donc rester en cache longtemps. */
export const communityThumbUrl = (c: CommunityCard): string => apiUrl(`/community/${c.id}/thumb`, { v: c.updated });

/** Corps de publication sérialisé une seule fois : la même chaîne sert au contrôle de taille et à l'envoi. */
async function publishBody(ed: Editor, author: string, token?: string): Promise<RawJson> {
  const [list, thumb] = await Promise.all([
    toShared({ title: ed.title, tiers: ed.tiers, pool: ed.pool, items: ed.items }),
    // Aperçu facultatif : en cas d'échec, la galerie affiche les mini-rangs.
    renderThumb(ed.tiers, ed.items).then((b) => (b ? blobToDataURL(b) : undefined)).catch(() => undefined),
  ]);
  const text = JSON.stringify({ author: author.trim(), list, ...(thumb ? { thumb } : {}), ...(token ? { token } : {}) } satisfies PublishBody);
  if (text.length > COMMUNITY.body) throw new ApiError(413, 'Liste trop lourde pour être publiée (trop d’images)');
  return new RawJson(text);
}

export async function publish(ed: Editor, author: string): Promise<Published> {
  const p = await apiPost<Published>('/community', await publishBody(ed, author));
  published[ed.id] = p;
  savePublished();
  return p;
}

/** Remplace la publication par l'état actuel de la liste. */
export async function republish(ed: Editor, author: string): Promise<void> {
  const p = published[ed.id];
  if (p) await apiPost(`/community/${p.id}/update`, await publishBody(ed, author, p.token));
}

/** Retire la publication de la liste locale listId (déjà retirée côté serveur : on oublie simplement le jeton). */
export async function unpublish(listId: string): Promise<void> {
  const p = published[listId];
  if (!p) return;
  try {
    await apiPost(`/community/${p.id}/delete`, { token: p.token });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  delete published[listId];
  savePublished();
}

export const fetchCommunityPage = (q: string, sort: CommunitySort, page: number, signal?: AbortSignal): Promise<CommunityPage> =>
  apiGet<CommunityPage>('/community', { q: q || undefined, sort, page: page || undefined }, signal);

export const fetchCommunityList = (id: string, signal?: AbortSignal): Promise<CommunityList> => apiGet<CommunityList>(`/community/${id}`, undefined, signal);

/**
 * « Faire ma version » : copie la liste publiée dans la bibliothèque locale ; renvoie l'id de la nouvelle liste.
 * La liste vient de la page déjà affichée et ses images de communityImageUrl, donc du cache du navigateur :
 * le serveur ne fait que compter la copie (et vérifier que la liste est toujours visible).
 */
export async function copyList(data: CommunityList): Promise<string> {
  const listId = uid();
  const imgs = data.board.items.filter((i) => i.type === 'img');
  const [blobs] = await Promise.all([
    mapLimit(imgs, 4, async (it) => {
      const r = await fetch(communityImageUrl(data.id, it.id)).catch(() => null);
      return r?.ok ? r.blob() : null;
    }),
    apiPost(`/community/${data.id}/copy`, {}),
  ]);
  const blobOf = new Map(imgs.map((it, i) => [it.id, blobs[i]]));
  // Nouveaux ids partout : la même liste peut être copiée plusieurs fois.
  const ids = new Map<string, string>();
  const items: Item[] = [];
  for (const it of data.board.items) {
    const id = uid();
    if (it.type === 'img') {
      const blob = blobOf.get(it.id);
      if (!blob) continue;
      items.push({ id, listId, type: 'img', text: it.text, blob });
    } else {
      const bg = it.bg ?? '#3d5afe';
      items.push({ id, listId, type: 'text', text: it.text, bg, fg: fgFor(bg) });
    }
    ids.set(it.id, id);
  }
  const remap = (a: string[]): string[] => a.flatMap((k) => ids.get(k) ?? []);
  const now = Date.now();
  await saveList(
    {
      id: listId,
      title: data.board.title || 'Tier liste importée',
      tiers: data.board.tiers.map((t) => ({ id: uid(), name: t.name, color: t.color, items: remap(t.items) })),
      pool: remap(data.board.pool),
      createdAt: now,
      updatedAt: now,
    },
    items,
  );
  const failed = imgs.length - imgs.filter((it) => blobOf.get(it.id)).length;
  if (failed) toast(`${plural(failed, 'image')} non récupérée${failed > 1 ? 's' : ''}`);
  return listId;
}

export const reportList = (id: string): Promise<unknown> => apiPost(`/community/${id}/report`, {});
