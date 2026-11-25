/** URLs objet par Blob : créées à la demande, une seule par image. */
let cache = new WeakMap<Blob, string>();
const live = new Set<string>();

export function blobUrl(b: Blob | undefined): string {
  if (!b) return '';
  let u = cache.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    cache.set(b, u);
    live.add(u);
  }
  return u;
}

/** Libère toutes les URLs (à la fermeture d'une liste). */
export function releaseUrls(): void {
  for (const u of live) URL.revokeObjectURL(u);
  live.clear();
  cache = new WeakMap();
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** Réduit une image (320 px max par défaut) et la ré-encode en WebP, ou PNG si WebP indisponible. */
export function shrink(file: Blob, max = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = async () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k));
      c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
      let b = await toBlob(c, 'image/webp', 0.85);
      if (!b || b.type !== 'image/webp') b = await toBlob(c, 'image/png');
      if (b) resolve(b);
      else reject(new Error('encodage impossible'));
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image illisible'));
    };
    im.src = url;
  });
}

export const blobToDataURL = (b: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export const dataURLToBlob = async (u: string): Promise<Blob> => (await fetch(u)).blob();
