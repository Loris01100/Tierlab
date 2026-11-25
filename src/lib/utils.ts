/** Identifiant aléatoire (fonctionne aussi hors contexte sécurisé, contrairement à randomUUID). */
export function uid(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const isColor = (c: unknown): c is string =>
  typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

export const hex6 = (c: string): string =>
  c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c;

/** Texte noir ou blanc selon la luminance du fond. */
export function fgFor(c: string): string {
  const h = hex6(c);
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#17181c' : '#ffffff';
}

export const isTyping = (a: Element | null): boolean =>
  !!a && ((a as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lecture/écriture localStorage tolérante (navigation privée, stockage bloqué). */
export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignoré */
  }
}

export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;
