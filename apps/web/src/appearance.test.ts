// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAppearance, readAppearance, writeAppearance } from './appearance';

describe('appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of ['theme', 'prose', 'motion']) delete document.documentElement.dataset[k];
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f4ee">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#101214">';
  });

  it('defaults when nothing is stored or the stored value is junk', () => {
    expect(readAppearance()).toEqual({ theme: 'system', prose: 'm', motion: 'system' });
    localStorage.setItem('doubletake.appearance', '{"theme":"neon","prose":"xl"}');
    expect(readAppearance()).toEqual({ theme: 'system', prose: 'm', motion: 'system' });
    localStorage.setItem('doubletake.appearance', 'not json');
    expect(readAppearance().theme).toBe('system');
  });

  it('writes, persists and applies data attributes on <html>', () => {
    const next = writeAppearance({ theme: 'ink', prose: 'l' });
    expect(next).toEqual({ theme: 'ink', prose: 'l', motion: 'system' });
    expect(readAppearance()).toEqual(next);
    const h = document.documentElement.dataset;
    expect(h.theme).toBe('ink');
    expect(h.prose).toBe('l');
    expect(h.motion).toBeUndefined();
    // A forced theme pins the browser chrome colour; system restores the media queries.
    const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas().every((m) => m.getAttribute('content') === '#101214')).toBe(true);
    expect(metas().every((m) => !m.hasAttribute('media'))).toBe(true);
    writeAppearance({ theme: 'system' });
    expect(h.theme).toBeUndefined();
    expect(metas().every((m) => m.hasAttribute('media'))).toBe(true);
  });

  it('applyAppearance with defaults clears attributes', () => {
    writeAppearance({ motion: 'reduce' });
    expect(document.documentElement.dataset.motion).toBe('reduce');
    applyAppearance({ theme: 'system', prose: 'm', motion: 'system' });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});
