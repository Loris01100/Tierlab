/** Routage minimal par hash : #/ (bibliothèque), #/list/<id> (éditeur) et #/live/<salle> (lien d'édition partagée). */
const read = (): string => location.hash.replace(/^#/, '') || '/';

export const route = $state({ path: read() });

addEventListener('hashchange', () => {
  route.path = read();
});

export function go(path: string): void {
  location.hash = path;
}

/** Change de page sans ajouter d'entrée à l'historique (replaceState ne déclenche pas hashchange). */
export function replace(path: string): void {
  history.replaceState(null, '', `#${path}`);
  route.path = path;
}

export const livePath = (room: string): string => `/live/${room}`;

export const listPath = (id: string): string => `/list/${id}`;
