import type { Item, Tier } from './types';
import { COMMUNITY } from '../../shared/community';
import { fgFor } from './utils';

/** Rendu de la tier liste dans un canvas PNG (indépendant du DOM). */

function wrapText(x: CanvasRenderingContext2D, txt: string, mw: number): string[] {
  const out: string[] = [];
  for (const para of String(txt).split('\n')) {
    let line = '';
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (x.measureText(w).width > mw && w.length > 1) {
        let k = w.length;
        while (k > 1 && x.measureText(w.slice(0, k)).width > mw) k--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      const test = line ? line + ' ' + w : w;
      if (line && x.measureText(test).width > mw) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

function fitText(
  x: CanvasRenderingContext2D, txt: string, cx: number, cy: number,
  mw: number, mh: number, col: string, max: number, wt: number,
) {
  for (let s = max; s >= 10; s -= 2) {
    x.font = `${wt} ${s}px Rubik, sans-serif`;
    const lines = wrapText(x, txt, mw);
    const lh = s * 1.12;
    const wordsFit = String(txt).split(/\s+/).every((w) => x.measureText(w).width <= mw);
    if ((lines.length * lh <= mh && wordsFit) || s <= 11) {
      x.fillStyle = col;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      lines.forEach((l, k) => x.fillText(l, cx, cy + (k - (lines.length - 1) / 2) * lh));
      x.textAlign = 'left';
      return;
    }
  }
}

/** Décode l'image d'une vignette ; null si elle est absente ou illisible (case vide). */
async function decodeImage(it: Item | undefined): Promise<ImageBitmap | null> {
  if (it?.type !== 'img' || !it.blob) return null;
  try {
    return await createImageBitmap(it.blob);
  } catch {
    return null;
  }
}

/** Vignettes décodées en parallèle par lots : plus rapide qu'une à une, sans garder toutes les images en mémoire. */
const BATCH = 16;

function drawTile(x: CanvasRenderingContext2D, it: Item | undefined, im: ImageBitmap | null, tx: number, ty: number, s: number) {
  if (!it) return;
  const cp = it.type === 'img' && it.text ? 40 : 0;
  x.save();
  x.beginPath();
  if (x.roundRect) x.roundRect(tx, ty, s, s + cp, 7);
  else x.rect(tx, ty, s, s + cp);
  x.clip();
  if (it.type === 'img') {
    if (im) {
      const k = Math.max(s / im.width, s / im.height);
      const w = im.width * k;
      const h = im.height * k;
      x.drawImage(im, tx + (s - w) / 2, ty + (s - h) / 2, w, h);
    }
    if (cp) {
      x.fillStyle = '#ffffff';
      x.fillRect(tx, ty + s, s, cp);
      fitText(x, it.text, tx + s / 2, ty + s + cp / 2, s - 8, cp - 6, '#17181c', 15, 600);
    }
  } else {
    x.fillStyle = it.bg ?? '#3d5afe';
    x.fillRect(tx, ty, s, s);
    fitText(x, it.text, tx + s / 2, ty + s / 2, s - 12, s - 12, it.fg ?? '#ffffff', 26, 700);
  }
  x.restore();
}

export async function renderTierList(title: string, tiers: Tier[], items: Record<string, Item>): Promise<HTMLCanvasElement> {
  try {
    await document.fonts.ready;
  } catch {
    /* ignoré */
  }
  const s = 110, G = 5, LW = 150, COLS = 8, M = 3, TH = 84, CAP = 40;
  const W = M * 2 + LW + G + COLS * (s + G);
  const cellH = (t: Tier) => (t.items.some((i) => items[i]?.type === 'img' && items[i].text) ? s + CAP : s);
  const hs = tiers.map((t) => Math.max(1, Math.ceil(t.items.length / COLS)) * (cellH(t) + G) + G);
  const H = TH + hs.reduce((a, b) => a + b + M, 0) + M;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#16171b';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffffff';
  x.font = '800 38px Rubik, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(title || 'Tier liste', 18, TH / 2, W - 36);

  let y = TH;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const h = hs[i];
    x.fillStyle = t.color;
    x.fillRect(M, y, LW, h);
    x.fillStyle = '#26282f';
    x.fillRect(M + LW, y, W - M * 2 - LW, h);
    fitText(x, t.name, M + LW / 2, y + h / 2, LW - 16, h - 16, fgFor(t.color), 42, 800);
    for (let b = 0; b < t.items.length; b += BATCH) {
      const ids = t.items.slice(b, b + BATCH);
      const ims = await Promise.all(ids.map((id) => decodeImage(items[id])));
      ids.forEach((id, k) => {
        const j = b + k;
        drawTile(x, items[id], ims[k], M + LW + G + (j % COLS) * (s + G), y + G + Math.floor(j / COLS) * (cellH(t) + G), s);
        ims[k]?.close();
      });
    }
    y += h + M;
  }
  return c;
}

/**
 * Aperçu d'une carte de la galerie (COMMUNITY.thumbW × thumbH, deux fois la taille affichée) : les premiers rangs
 * et leurs premières vignettes, comme l'aperçu en mini-rangs. Fond transparent et cases en gris translucide pour
 * rester lisible en thème clair comme sombre. Une seule image par carte au lieu d'une requête par vignette.
 * null si le navigateur ne sait pas l'encoder ou si elle dépasse COMMUNITY.thumb.
 */
export async function renderThumb(tiers: Tier[], items: Record<string, Item>): Promise<Blob | null> {
  try {
    await document.fonts.ready;
  } catch {
    /* ignoré */
  }
  const { thumbW: W, thumbH: H, previewTiers: N, previewItems: K } = COMMUNITY;
  const G = 6, LW = 60, P = 6;
  const rh = (H - G * (N - 1)) / N;
  const s = rh - P * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const box = (bx: number, by: number, w: number, h: number, r: number) => {
    x.beginPath();
    if (x.roundRect) x.roundRect(bx, by, w, h, r);
    else x.rect(bx, by, w, h);
  };
  for (const [i, t] of tiers.slice(0, N).entries()) {
    const y = i * (rh + G);
    box(0, y, LW, rh, 10);
    x.fillStyle = t.color;
    x.fill();
    x.font = '800 24px Rubik, sans-serif';
    x.fillStyle = fgFor(t.color);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(t.name.slice(0, 3), LW / 2, y + rh / 2, LW - 8);
    box(LW + 8, y, W - LW - 8, rh, 10);
    x.fillStyle = 'rgba(128, 132, 145, 0.18)';
    x.fill();
    const ids = t.items.slice(0, K);
    const ims = await Promise.all(ids.map((id) => decodeImage(items[id])));
    ids.forEach((id, j) => {
      const it = items[id];
      const im = ims[j];
      if (!it) return;
      const tx = LW + 8 + P + j * (s + P);
      x.save();
      box(tx, y + P, s, s, 6);
      x.clip();
      x.fillStyle = it.type === 'text' ? (it.bg ?? '#3d5afe') : 'rgba(128, 132, 145, 0.45)';
      x.fillRect(tx, y + P, s, s);
      if (im) {
        const k = Math.max(s / im.width, s / im.height);
        x.drawImage(im, tx + (s - im.width * k) / 2, y + P + (s - im.height * k) / 2, im.width * k, im.height * k);
        im.close();
      }
      x.restore();
    });
  }
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.82));
  return blob && blob.size <= COMMUNITY.thumb ? blob : null;
}
