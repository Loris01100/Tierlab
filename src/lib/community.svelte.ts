import { COMMUNITY, type CommunityList, type CommunityPage, type CommunitySort, type Published, type PublishBody } from '../../shared/community';
import { ApiError, apiGet, apiPost, apiUrl } from './api';
import type { Editor } from './editor.svelte';
import { saveShared, toShared } from './share';
import { pref, setPref } from './utils';

/**
 * Galerie communautaire (serveur : server/gallery.ts). Publier envoie une copie figée de la liste ouverte ;
 * le jeton reçu reste sur cet appareil (localStorage) et permet de mettre à jour ou de retirer la publication.
 */

const KEY = 'tierlab-published';

/** Publications faites depuis cet appareil : id de la liste locale → publication. */
export const published = $state<Record<string, Published>>(pref(KEY, {}));

const save = () => setPref(KEY, $state.snapshot(published));

/** Id de la liste locale qui a donné cette publication, si elle vient de cet appareil. */
export const ownerOf = (pubId: string): string | undefined => Object.keys(published).find((k) => published[k].id === pubId);

export const communityImg = (id: string, item: string): string => apiUrl(`/community/${id}/img/${item}`);

async function body(ed: Editor, author: string, token?: string): Promise<PublishBody> {
  const list = await toShared({ title: ed.title, tiers: ed.tiers, pool: ed.pool, items: ed.items });
  const b: PublishBody = { author: author.trim(), list, ...(token ? { token } : {}) };
  if (JSON.stringify(b).length > COMMUNITY.body) throw new ApiError(413, 'Liste trop lourde pour être publiée (trop d’images)');
  return b;
}

export async function publish(ed: Editor, author: string): Promise<Published> {
  const p = await apiPost<Published>('/community', await body(ed, author));
  published[ed.id] = p;
  save();
  return p;
}

/** Remplace la publication par l'état actuel de la liste. */
export async function republish(ed: Editor, author: string): Promise<void> {
  const p = published[ed.id];
  if (p) await apiPost(`/community/${p.id}/update`, await body(ed, author, p.token));
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
  save();
}

export const fetchPage = (q: string, sort: CommunitySort, page: number, signal?: AbortSignal): Promise<CommunityPage> =>
  apiGet<CommunityPage>('/community', { q: q || undefined, sort, page: page || undefined }, signal);

export const fetchList = (id: string, signal?: AbortSignal): Promise<CommunityList> => apiGet<CommunityList>(`/community/${id}`, undefined, signal);

/** « Faire ma version » : copie la liste publiée dans la bibliothèque locale ; renvoie l'id de la nouvelle liste. */
export async function copyList(id: string): Promise<string> {
  const raw = await apiPost<unknown>(`/community/${id}/copy`, {});
  const listId = await saveShared(raw);
  if (!listId) throw new ApiError(0, 'Liste reçue illisible');
  return listId;
}

export const report = (id: string): Promise<unknown> => apiPost(`/community/${id}/report`, {});
