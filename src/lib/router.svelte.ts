/**
 * Routage minimal par hash : #/ (bibliothèque), #/community (galerie), #/community/<id> (liste publiée),
 * #/list/<id> (éditeur) et #/live/<salle> (lien d'édition partagée).
 */
const currentPath = (): string => location.hash.replace(/^#/, '') || '/';

export const route = $state({ path: currentPath() });

addEventListener('hashchange', () => {
  route.path = currentPath();
});

export function go(path: string): void {
  location.hash = path;
}

/** Change de page sans ajouter d'entrée à l'historique (replaceState ne déclenche pas hashchange). */
export function replaceRoute(path: string): void {
  history.replaceState(null, '', `#${path}`);
  route.path = path;
}

export const livePath = (room: string): string => `/live/${room}`;

export const listPath = (id: string): string => `/list/${id}`;

export const COMMUNITY_PATH = '/community';

export const communityPath = (id: string): string => `${COMMUNITY_PATH}/${id}`;
