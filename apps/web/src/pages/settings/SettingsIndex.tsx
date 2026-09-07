import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, type Device, type IgStatus, type Status } from '../../api';
import { readAppearance } from '../../appearance';
import { Icon } from '../../components/Icon';
import { isNative, nativePlatform, nativePushEnabled } from '../../native';
import { pushEnabled, pushSupported } from '../../push';
import { Group, Row } from './parts';

interface Entry {
  section: string;
  icon: Parameters<typeof Row>[0]['icon'];
  label: string;
  hint: string;
  keywords: string;
}

const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Account and devices',
    entries: [
      {
        section: 'devices',
        icon: 'smartphone',
        label: 'Devices',
        hint: 'This device, pairing, revoke',
        keywords: 'pair qr code token sign out revoke phone mcp agent',
      },
    ],
  },
  {
    title: 'Research',
    entries: [
      {
        section: 'research',
        icon: 'compass',
        label: 'Brains and spend',
        hint: 'Adapter health, daily cap, modes',
        keywords: 'brain adapter model claude gemini cap cost budget quick standard deep',
      },
    ],
  },
  {
    title: 'Notifications and channels',
    entries: [
      {
        section: 'notifications',
        icon: 'bell',
        label: 'Notifications',
        hint: 'Push, quiet hours, digest',
        keywords: 'push web fcm quiet hours digest ntfy telegram test',
      },
      {
        section: 'instagram',
        icon: 'instagram',
        label: 'Instagram',
        hint: 'Shadow account and mentions',
        keywords: 'instagram ig dm mention comment webhook connect poll',
      },
    ],
  },
  {
    title: 'Data',
    entries: [
      {
        section: 'data',
        icon: 'download',
        label: 'Import and export',
        hint: 'Karakeep, Memos, notes folder',
        keywords: 'import export karakeep memos json backup notes markdown folder',
      },
    ],
  },
  {
    title: 'App',
    entries: [
      {
        section: 'appearance',
        icon: 'sun',
        label: 'Appearance',
        hint: 'Theme, reading size, motion',
        keywords: 'theme dark light paper ink font size prose reduce motion',
      },
      {
        section: 'about',
        icon: 'info',
        label: 'About',
        hint: 'Version, server, docs',
        keywords: 'version server url docs licence agpl',
      },
    ],
  },
];

export const SECTIONS = new Set(GROUPS.flatMap((g) => g.entries.map((e) => e.section)));

/**
 * Settings home: a searchable grouped list. Each row shows a live one-line value pulled from
 * the cheap status calls, and opens its section page.
 */
export function SettingsIndex() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [ig, setIg] = useState<IgStatus | 'off' | null>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const native = isNative();
  const ios = native && nativePlatform() === 'ios';

  useEffect(() => {
    api
      .status('skip')
      .then(setStatus)
      .catch(() => {});
    api
      .devices()
      .then(setDevices)
      .catch(() => {});
    api
      .igStatus()
      .then(setIg)
      .catch((e) => setIg(e instanceof ApiError && e.status === 404 ? 'off' : null));
    if (ios || (!native && !pushSupported())) setPush(false);
    else (native ? nativePushEnabled() : pushEnabled()).then(setPush).catch(() => setPush(false));
  }, [native, ios]);

  const appearance = readAppearance();
  const values: Record<string, { value: string; status?: 'ok' | 'warn' | 'err' | undefined }> =
    useMemo(
      () => ({
        devices: { value: devices ? `${devices.length} paired` : '' },
        research: status
          ? {
              value: `$${status.spentTodayUsd.toFixed(2)} / $${status.dailyCapUsd.toFixed(0)}`,
              status: status.spentTodayUsd >= status.dailyCapUsd ? 'warn' : undefined,
            }
          : { value: '' },
        notifications:
          push === null
            ? { value: '' }
            : { value: push ? 'On' : 'Off', status: push ? 'ok' : undefined },
        instagram:
          ig === null
            ? { value: '' }
            : ig === 'off'
              ? { value: 'Not set up' }
              : ig.connected
                ? { value: `@${ig.username ?? ig.igUserId}`, status: 'ok' }
                : { value: 'Not connected', status: 'warn' },
        data: { value: '' },
        appearance: {
          value:
            appearance.theme === 'system' ? 'System' : appearance.theme === 'ink' ? 'Ink' : 'Paper',
        },
        about: { value: '' },
      }),
      [devices, status, push, ig, appearance.theme],
    );

  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    entries: g.entries.filter(
      (e) =>
        !needle ||
        e.label.toLowerCase().includes(needle) ||
        e.hint.toLowerCase().includes(needle) ||
        e.keywords.includes(needle),
    ),
  })).filter((g) => g.entries.length > 0);

  return (
    <div className="page narrow settings stack loose">
      <div className="page-head">
        <h2>Settings</h2>
      </div>
      <search>
        <label className="searchbar">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Search settings"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search settings"
          />
        </label>
      </search>
      {groups.length === 0 && (
        <p className="muted small empty-note">Nothing matches “{q}”. Try “theme” or “push”.</p>
      )}
      {groups.map((g) => (
        <Group title={g.title} key={g.title}>
          {g.entries.map((e) => (
            <Row
              key={e.section}
              icon={e.icon}
              label={e.label}
              hint={e.hint}
              to={`/settings/${e.section}`}
              value={values[e.section]?.value || undefined}
              status={values[e.section]?.status}
            />
          ))}
        </Group>
      ))}
    </div>
  );
}
