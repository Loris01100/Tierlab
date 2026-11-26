import { HttpError, type Route } from './api';

/**
 * Relais d'images unique pour tous les services : même origine pour le navigateur (pas de souci CORS pour le canvas).
 * Chaque module déclare les domaines de ses images ; tout le reste est refusé (pas de relais ouvert, pas de SSRF).
 */

export interface ImageHost {
  host: string;
  /** Accepte aussi les sous-domaines (`*.dzcdn.net`). */
  sub?: boolean;
  /** Préfixe de chemin imposé, pour un hôte partagé comme raw.githubusercontent.com. */
  path?: string;
}

const MAX_BYTES = 8_000_000;
/** Certaines images passent par des redirections (Open Library → archive.org) : chaque étape est revérifiée. */
const MAX_HOPS = 3;

export function isAllowed(u: URL, hosts: readonly ImageHost[]): boolean {
  if (u.protocol !== 'https:' || u.port) return false;
  return hosts.some(
    (h) => (u.hostname === h.host || (!!h.sub && u.hostname.endsWith(`.${h.host}`))) && (!h.path || u.pathname.startsWith(h.path)),
  );
}

function parseImageUrl(raw: string | null): URL {
  try {
    return new URL(raw ?? '');
  } catch {
    throw new HttpError(400, 'URL d’image invalide');
  }
}

export function imageRoutes(hosts: readonly ImageHost[]): Route[] {
  return [
    {
      method: 'GET',
      path: '/image',
      async handler({ query }) {
        let u = parseImageUrl(query.get('url'));
        for (let hop = 0; ; hop++) {
          if (!isAllowed(u, hosts)) throw new HttpError(400, 'Domaine d’image non autorisé');
          // redirect: 'manual' (les Workers refusent 'error') : on suit nous-mêmes pour vérifier chaque destination.
          const r = await fetch(u, { redirect: 'manual' }).catch(() => null);
          if (!r) throw new HttpError(502, 'Image indisponible');
          const loc = r.headers.get('Location');
          if (r.status >= 300 && r.status < 400 && loc && hop < MAX_HOPS) {
            void r.body?.cancel().catch(() => {});
            u = new URL(loc, u);
            continue;
          }
          const type = r.headers.get('Content-Type') ?? '';
          const tooBig = Number(r.headers.get('Content-Length')) > MAX_BYTES;
          if (!r.ok || !r.body || !type.startsWith('image/') || tooBig) {
            // Libère la connexion sortante au lieu d'attendre que le corps non lu soit abandonné.
            void r.body?.cancel().catch(() => {});
            throw new HttpError(502, tooBig ? 'Image trop lourde' : 'Image indisponible');
          }
          // Les URL d'images de ces services identifient une image précise : leur contenu ne change pas.
          return new Response(r.body, {
            status: 200,
            headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000, immutable' },
          });
        }
      },
    },
  ];
}
