/**
 * Appels vers le serveur de l'application (/api/...), qui relaie les services externes.
 * Le navigateur ne connaît jamais les clés : elles restent dans .env.local, côté serveur.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

export function apiUrl(path: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return `/api${path}${s ? `?${s}` : ''}`;
}

/** GET JSON. Lève ApiError avec le message du serveur (en français) en cas d'échec. */
export function apiGet<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  return request<T>(apiUrl(path, params), { signal, headers: { Accept: 'application/json' } });
}

/** POST d'un corps JSON, ou d'un Blob tel quel (son type devient le Content-Type). */
export function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const blob = body instanceof Blob;
  return request<T>(apiUrl(path), {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': blob ? body.type : 'application/json' },
    body: blob ? body : JSON.stringify(body),
  });
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Serveur injoignable');
  }
  const isJson = r.headers.get('Content-Type')?.includes('application/json');
  const body = isJson ? await r.json().catch(() => null) : null;
  if (!r.ok || !isJson) {
    const msg = (body as { error?: string } | null)?.error;
    // Sans JSON : l'API n'existe pas (ex. site statique servi sans le serveur Vite).
    throw new ApiError(r.status, msg ?? (isJson ? `Erreur ${r.status}` : 'API indisponible : lancez l’application avec npm run dev ou npm run preview'));
  }
  return body as T;
}

/** URL d'une image externe relayée par le serveur (domaines autorisés : voir server/media.ts). */
export const imageUrl = (url: string): string => apiUrl('/image', { url });

/** Télécharge une image externe en Blob, via le relais du serveur. */
export async function fetchImage(url: string, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(imageUrl(url), { signal });
  if (!r.ok) throw new Error('image indisponible');
  return r.blob();
}

/** Exécute fn sur chaque élément avec au plus `limit` appels simultanés, en gardant l'ordre. */
export async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}
