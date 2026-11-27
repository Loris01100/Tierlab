import { COMMUNITY, type CommunityCard, type CommunityList, type CommunityPage, type CommunitySort, type Published, type PublishBody } from '../../shared/community';
import { ApiError, apiGet, apiPost, apiUrl, RawJson } from './api';
import type { Editor } from './editor.svelte';
import { renderThumb } from './exportImage';
import { blobToDataURL } from './images';
import { saveShared, toShared } from './share';
import { getPref, setPref } from './utils';

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

/** « Faire ma version » : copie la liste publiée dans la bibliothèque locale ; renvoie l'id de la nouvelle liste. */
export async function copyList(id: string): Promise<string> {
  const raw = await apiPost<unknown>(`/community/${id}/copy`, {});
  const listId = await saveShared(raw);
  if (!listId) throw new ApiError(0, 'Liste reçue illisible');
  return listId;
}

export const reportList = (id: string): Promise<unknown> => apiPost(`/community/${id}/report`, {});
