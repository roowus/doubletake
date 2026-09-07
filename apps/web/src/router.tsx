import type React from 'react';
import { useEffect, useState } from 'react';

/** Minimal history-based router: one hook, one navigate function. Keeps the bundle small. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', on);
    window.addEventListener('doubletake:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('doubletake:navigate', on);
    };
  }, []);
  return path;
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event('doubletake:navigate'));
}

/**
 * Navigate with a View Transition when the browser has them (Chromium, Safari 18); a plain
 * navigate otherwise or under reduced motion. The caller marks shared elements with
 * `view-transition-name` in CSS.
 */
export function navigateWithTransition(to: string, replace = false): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => Promise<void> | void) => unknown;
  };
  const reduce =
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduce';
  if (!doc.startViewTransition || reduce) {
    navigate(to, replace);
    return;
  }
  doc.startViewTransition(() => {
    navigate(to, replace);
    // Let React commit the new route before the transition snapshots it.
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

export function Link({
  to,
  children,
  onClick,
  ...rest
}: { to: string; children: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
