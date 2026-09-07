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
  { to: '/library', label: 'Library', icon: 'library', match: /^\/(library|entities\/.*|map)$/ },
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
        <Link to="/" className="brand" aria-label="Doubletake, inbox">
          <span className="brand-mark">
            <Icon name="doubletake" size={20} />
          </span>
          <span className="brand-name">Doubletake</span>
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
