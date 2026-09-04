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
