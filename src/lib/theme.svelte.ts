import { getPref, setPref } from './utils';

/** Thème choisi : « auto » suit le système, les deux autres forcent `color-scheme` via `data-theme` sur <html>. */
export type Theme = 'auto' | 'light' | 'dark';

const ORDER: readonly Theme[] = ['auto', 'light', 'dark'];

export const theme = $state({ value: getPref<Theme>('tierlab-theme', 'auto') });

function apply(t: Theme): void {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
apply(theme.value);

/** Passe au thème suivant (auto → clair → sombre) et le mémorise. */
export function cycleTheme(): void {
  theme.value = ORDER[(ORDER.indexOf(theme.value) + 1) % ORDER.length];
  apply(theme.value);
  setPref('tierlab-theme', theme.value);
}

export const THEME_LABEL: Record<Theme, string> = { auto: 'Thème : système', light: 'Thème : clair', dark: 'Thème : sombre' };
