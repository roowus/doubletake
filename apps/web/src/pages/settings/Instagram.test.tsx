// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type IgLinkStatus, type IgStatus } from '../../api';
import { HOSTED_OFF, setHostedForTest } from '../../lib/hosted';
import { InstagramSettings } from './Instagram';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The self-hosted status the server answers when IG_APP_ID/IG_APP_SECRET are set. */
const IG_STATUS: IgStatus = {
  configured: true,
  connected: true,
  igUserId: '17841400000000000',
  username: 'own.account',
  expiresAt: '2026-11-01T00:00:00.000Z',
  refreshedAt: '2026-10-01T00:00:00.000Z',
  webhookPublicHost: 'https://self.example.test',
  mentionPolling: true,
  scopes: ['instagram_business_manage_messages'],
  recentEvents: [],
};

/**
 * Stub the handful of `api` calls these two branches may make, so each one sees exactly the
 * calls it is supposed to make and nothing else. Anything a branch should not touch is left
 * as a vi.fn() that fails the test if it is ever called.
 */
interface ApiStubs {
  igLinkStatus: () => Promise<IgLinkStatus>;
  igCreateLink: () => Promise<{ code: string; expiresAt: string }>;
  igUnlink: () => Promise<{ ok: boolean }>;
  igStatus: () => Promise<IgStatus>;
}

/** Each stub keeps its real signature, so `mockImplementation` stays type-checked. */
type Spy<T extends (...args: never[]) => unknown> = ReturnType<typeof vi.fn<T>>;

type ApiSpies = {
  [K in keyof ApiStubs]: Spy<ApiStubs[K]>;
};

function stubApi(over: Partial<ApiStubs>): ApiSpies {
  const spies: ApiSpies = {
    igLinkStatus: vi.fn(async () => ({ linked: false })),
    igCreateLink: vi.fn(async () => ({
      code: 'ABCD2345',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    })),
    igUnlink: vi.fn(async () => ({ ok: true })),
    igStatus: vi.fn(async () => IG_STATUS),
  };
  for (const [name, impl] of Object.entries(over)) {
    (spies[name as keyof ApiStubs] as Spy<() => unknown>).mockImplementation(impl as never);
  }
  // One explicit spyOn per method: `keyof typeof api` is an 80-member union, and both a dynamic
  // index there and `ReturnType<typeof vi.fn>` (which erases the signature) defeat tsc.
  vi.spyOn(api, 'igLinkStatus').mockImplementation(spies.igLinkStatus);
  vi.spyOn(api, 'igCreateLink').mockImplementation(spies.igCreateLink);
  vi.spyOn(api, 'igUnlink').mockImplementation(spies.igUnlink);
  vi.spyOn(api, 'igStatus').mockImplementation(spies.igStatus);
  return spies;
}

describe('InstagramSettings', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    setHostedForTest(null);
  });

  const HOSTED_ON = { hosted: true, inviteRequired: false };

  /** Renders and flushes the mount-time status load. */
  async function render(hosted: { hosted: boolean; inviteRequired: boolean } = HOSTED_ON) {
    act(() => setHostedForTest(hosted));
    await act(async () => root.render(<InstagramSettings />));
    await act(async () => {});
  }

  it('shows the three connect steps and a Connect button while not linked', async () => {
    const spies = stubApi({});
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('Connect Instagram');
    expect(text).toContain('@dt.save');
    expect(host.querySelector('button.primary')?.textContent).toBe('Connect');
    expect(text).not.toContain('No account connected');
    expect(spies.igStatus).not.toHaveBeenCalled();
  });

  it('shows the code large with a countdown and the DM line after Connect', async () => {
    const spies = stubApi({});
    await render();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button.primary')?.click();
    });
    await act(async () => {});
    expect(spies.igCreateLink).toHaveBeenCalledTimes(1);
    const code = host.querySelector('.pair-code');
    expect(code?.textContent).toBe('ABCD2345');
    // A fresh 15-minute code: 14:59 or 14:58 depending on when the tick lands.
    expect(host.textContent).toMatch(/Expires in 14:5\d/);
    expect(host.querySelector<HTMLButtonElement>('button.primary')?.textContent).toBe(
      'Connect again',
    );
    expect(host.textContent).toContain('Copy code');
    expect(host.textContent).toContain('Copy the DM');
  });

  it('copies the exact DM line the unpaired-sender prompt tells people to send', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    stubApi({});
    await render();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button.primary')?.click();
    });
    await act(async () => {});
    const copyDm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Copy the DM',
    );
    await act(async () => {
      copyDm?.click();
    });
    expect(writeText).toHaveBeenCalledWith(
      'To save this: connect your account at doubletake.gg → Settings → Instagram, then DM me the code it shows.',
    );
  });

  it('shows the handle, the link date and Unlink once linked, and calls DELETE on confirm', async () => {
    const spies = stubApi({
      igLinkStatus: vi.fn(async () => ({
        linked: true,
        igUsername: 'taken',
        linkedAt: '2026-10-10T09:00:00.000Z',
      })),
    });
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('@taken');
    expect(text).toContain('Linked');
    expect(text).toContain('Unlink');
    expect(text).not.toContain('Connect Instagram');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button.srow.danger')?.click();
    });
    await act(async () => {});
    expect(document.body.textContent).toContain("Reels you send after unlinking won't be saved");
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.sheet-foot button')].find(
      (b) => b.textContent === 'Unlink',
    );
    await act(async () => {
      confirm?.click();
    });
    await act(async () => {});
    expect(spies.igUnlink).toHaveBeenCalledTimes(1);
  });

  it('surfaces an API failure inline instead of a stack', async () => {
    stubApi({
      igCreateLink: vi.fn(async () => {
        throw new Error('code expired');
      }),
    });
    await render();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button.primary')?.click();
    });
    await act(async () => {});
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('code expired');
  });

  it('keeps the self-hosted controls (own account, polling, webhook host) when not hosted', async () => {
    const spies = stubApi({});
    await render(HOSTED_OFF);
    const text = host.textContent ?? '';
    expect(text).toContain('@own.account');
    expect(text).toContain('Mention polling');
    expect(text).toContain('Webhook host');
    expect(text).toContain('https://self.example.test');
    expect(text).toContain('Poll mentions now');
    expect(text).toContain('Disconnect');
    expect(text).not.toContain('Connect Instagram');
    expect(spies.igLinkStatus).not.toHaveBeenCalled();
  });
});
