/**
 * Appearance preferences (Settings → Appearance): theme, prose size, motion. Stored in
 * localStorage and mirrored onto `<html>` as data attributes that styles.css keys off:
 * `data-theme="paper|ink"` (absent = follow the system), `data-prose="s|l"` (absent = medium),
 * `data-motion="reduce"` (absent = follow `prefers-reduced-motion`). `applyAppearance()` runs
 * once at boot so the first paint already has the owner's choice.
 */

export type Theme = 'system' | 'paper' | 'ink';
export type ProseSize = 's' | 'm' | 'l';
export type Motion = 'system' | 'reduce';

export interface Appearance {
  theme: Theme;
  prose: ProseSize;
  motion: Motion;
}

const KEY = 'doubletake.appearance';
const DEFAULTS: Appearance = { theme: 'system', prose: 'm', motion: 'system' };
const THEMES = new Set<Theme>(['system', 'paper', 'ink']);
const SIZES = new Set<ProseSize>(['s', 'm', 'l']);
const MOTIONS = new Set<Motion>(['system', 'reduce']);

export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Record<keyof Appearance, unknown>>;
    return {
      theme: THEMES.has(v.theme as Theme) ? (v.theme as Theme) : DEFAULTS.theme,
      prose: SIZES.has(v.prose as ProseSize) ? (v.prose as ProseSize) : DEFAULTS.prose,
      motion: MOTIONS.has(v.motion as Motion) ? (v.motion as Motion) : DEFAULTS.motion,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Mirror a preference set onto `<html>`; defaults remove the attribute so CSS falls back. */
export function applyAppearance(a: Appearance = readAppearance()): void {
  const el = document.documentElement;
  if (a.theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = a.theme;
  if (a.prose === 'm') delete el.dataset.prose;
  else el.dataset.prose = a.prose;
  if (a.motion === 'system') delete el.dataset.motion;
  else el.dataset.motion = a.motion;
  updateThemeColor(a.theme);
}

export function writeAppearance(patch: Partial<Appearance>): Appearance {
  const next = { ...readAppearance(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the choice still applies for this session.
  }
  applyAppearance(next);
  window.dispatchEvent(new Event('doubletake:appearance'));
  return next;
}

/** Keep the browser chrome (address bar, PWA title bar) matching a forced theme. */
function updateThemeColor(theme: Theme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const m of metas) {
    const media = m.getAttribute('data-media') ?? m.getAttribute('media') ?? '';
    if (media && !m.getAttribute('data-media')) m.setAttribute('data-media', media);
    if (theme === 'system') {
      if (media) m.setAttribute('media', media);
    } else {
      // One meta wins: give it the forced colour and drop the media queries.
      m.removeAttribute('media');
      m.setAttribute('content', theme === 'ink' ? '#101214' : '#f7f4ee');
    }
  }
}
