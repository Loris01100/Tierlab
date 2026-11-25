import { PARTY } from './constants';
import { reducedMotion } from './utils';

/** Confettis sur un canvas plein écran, créé à la première utilisation. */
interface Part {
  x: number; y: number; vx: number; vy: number;
  r: number; vr: number; w: number; h: number;
  c: string; life: number; star: boolean;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let parts: Part[] = [];
let running = false;

function setup(): CanvasRenderingContext2D {
  if (ctx) return ctx;
  canvas = document.createElement('canvas');
  canvas.className = 'fx';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d')!;
  const size = () => {
    const d = devicePixelRatio || 1;
    canvas!.width = innerWidth * d;
    canvas!.height = innerHeight * d;
    ctx!.setTransform(d, 0, 0, d, 0, 0);
  };
  size();
  addEventListener('resize', size);
  return ctx;
}

function star(c: CanvasRenderingContext2D, r: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const q = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  c.closePath();
  c.fill();
}

function step() {
  const c = ctx!;
  c.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vy += 0.2; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.011;
    c.save();
    c.globalAlpha = Math.min(1, p.life * 2.2);
    c.translate(p.x, p.y);
    c.rotate(p.r);
    c.fillStyle = p.c;
    if (p.star) star(c, p.w * 0.8);
    else c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    c.restore();
  }
  if (parts.length) requestAnimationFrame(step);
  else {
    running = false;
    c.clearRect(0, 0, innerWidth, innerHeight);
  }
}

export function burst(x: number, y: number, cols: string[], n = 22, pw = 1): void {
  if (reducedMotion()) return;
  setup();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (1.5 + Math.random() * 5) * pw;
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.5 * pw,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.45,
      w: 5 + Math.random() * 7, h: 3 + Math.random() * 4,
      c: cols[i % cols.length], life: 1, star: Math.random() < 0.3,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(step);
  }
}

export const burstAt = (el: Element, cols: string[], n?: number, pw?: number): void => {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, cols, n, pw);
};

/** Pluie de confettis (liste terminée, chrono écoulé). */
export function rain(): void {
  if (reducedMotion()) return;
  for (let k = 0; k < 7; k++)
    setTimeout(() => burst(innerWidth * (0.1 + Math.random() * 0.8), innerHeight * (0.1 + Math.random() * 0.3), PARTY, 45, 1.5), k * 170);
}

export const poof = (el: Element | null): void => {
  if (el) burstAt(el, ['#9aa0ad', '#e5484d', '#d2d5dd'], 18, 0.8);
};

export const SPRING = 'cubic-bezier(.2,1.25,.35,1)';
