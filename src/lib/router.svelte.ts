/** Routage minimal par hash : #/ (bibliothèque) et #/list/<id> (éditeur). */
const read = (): string => location.hash.replace(/^#/, '') || '/';

export const route = $state({ path: read() });

addEventListener('hashchange', () => {
  route.path = read();
});

export function go(path: string): void {
  location.hash = path;
}

export const listPath = (id: string): string => `/list/${id}`;
