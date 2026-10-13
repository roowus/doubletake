import type React from 'react';
import { Link } from '../router';
import { Icon, type IconName } from './Icon';

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  /** Route prefixes that keep this tab highlighted. */
  match: RegExp;
}

const TABS: Tab[] = [
  { to: '/', label: 'Inbox', icon: 'inbox', match: /^\/(chat\/.*)?$/ },
  {
    to: '/library',
    label: 'Library',
    icon: 'library',
    match: /^\/(library|entities\/.*|map|todo)$/,
  },
  { to: '/compose', label: 'Add', icon: 'plus', match: /^\/(compose|share)$/ },
  { to: '/settings', label: 'Settings', icon: 'settings', match: /^\/settings(\/.*)?$/ },
];

/**
 * Four-tab shell: bottom tab bar on phones, left rail from 900 px. Detail pages (a chat)
 * pass `bare` so the phone tab bar makes room for their own sticky composer.
 */
export function Shell({
  pathname,
  bare = false,
  children,
}: {
  pathname: string;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={bare ? 'shell bare' : 'shell'}>
      <nav className="shell-nav" aria-label="Primary">
        <Link to="/library" className="brand" aria-label="Doubletake, library">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 512 512" focusable="false"><rect x="16" y="16" width="480" height="480" rx="118" fill="#C45A3C"/><rect x="128" y="372" width="256" height="40" rx="20" fill="#F7F3E9"/><rect x="196" y="118" width="40" height="194" rx="20" fill="#F7F3E9"/><path d="M178 296h76l-38 64z" fill="#F7F3E9"/><rect x="276" y="118" width="40" height="194" rx="20" fill="#F7F3E9"/><path d="M258 296h76l-38 64z" fill="#F7F3E9"/></svg>
          </span>
        </Link>
        <ul className="tabs-list">
          {TABS.map((t) => {
            const on = t.match.test(pathname);
            return (
              <li key={t.to}>
                <Link to={t.to} className="tab" aria-current={on ? 'page' : undefined}>
                  <Icon name={t.icon} size={22} />
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="shell-main">{children}</main>
    </div>
  );
}
