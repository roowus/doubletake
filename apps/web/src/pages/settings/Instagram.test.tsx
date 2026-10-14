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

  /**
   * Live pairing: redeeming a code happens on Instagram's side, so this tab has to find out.
   * These drive the poll with fake timers and a status stub that can flip to linked, which is
   * what the real server reports once the webhook stores the link.
   */
  describe('live pairing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Flush pending microtasks under fake timers without advancing the clock. */
    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    const advance = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    const linkedStatus = {
      linked: true as const,
      igUsername: 'paired',
      linkedAt: '2026-10-14T08:00:00.000Z',
    };
    /** The expiry the create stub hands out; kept in step with `stubApi`'s default. */
    const FUTURE = new Date(Date.now() + 15 * 60_000).toISOString();
    /**
     * A status stub that answers "not linked, code still live" until `flip()` is called. The
     * code is echoed back because that is what the server does while a code is outstanding —
     * a stub that omits it would (correctly) clear the code on screen.
     */
    function flipSpy() {
      const box = { linked: false };
      const spy = vi.fn(async () =>
        box.linked ? linkedStatus : { linked: false as const, code: 'ABCD2345', expiresAt: FUTURE },
      );
      return { box, spy };
    }

    it('flips to linked on its own once the code is redeemed, without a manual refresh', async () => {
      const { box, spy } = flipSpy();
      stubApi({ igLinkStatus: spy });
      await render();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button.primary')?.click();
      });
      await flush();
      expect(host.querySelector('.pair-code')?.textContent).toBe('ABCD2345');
      expect(host.textContent).not.toContain("You're paired");

      // Still waiting: a poll goes out and nothing changes yet.
      await advance(4000);
      expect(host.querySelector('.pair-code')?.textContent).toBe('ABCD2345');

      // The user sends the DM; the server stores the link.
      box.linked = true;
      await advance(4000);

      expect(host.textContent).toContain('@paired');
      expect(host.textContent).toContain("You're paired");
      expect(host.querySelector('.pair-code')).toBeNull();
      expect(host.querySelector('.pair-success')).not.toBeNull();
    });

    it('stops polling once linked, so the linked screen makes no further requests', async () => {
      const { box, spy } = flipSpy();
      stubApi({ igLinkStatus: spy });
      await render();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button.primary')?.click();
      });
      await flush();
      box.linked = true;
      await advance(4000);

      const callsAtLink = spy.mock.calls.length;
      await advance(4000 * 5);
      expect(spy.mock.calls.length).toBe(callsAtLink);
    });

    it('does not poll when there is no live code to redeem', async () => {
      const spies = stubApi({});
      await render();
      await advance(4000 * 5);
      // One call for the mount load, and nothing after it.
      expect(spies.igLinkStatus).toHaveBeenCalledTimes(1);
    });

    it('clears a code the server no longer has (expired or regenerated)', async () => {
      stubApi({ igLinkStatus: vi.fn(async () => ({ linked: false as const })) });
      await render();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button.primary')?.click();
      });
      await flush();
      expect(host.querySelector('.pair-code')?.textContent).toBe('ABCD2345');
      await advance(4000);
      expect(host.querySelector('.pair-code')).toBeNull();
      expect(host.textContent).toContain('No code yet');
    });

    it('keeps the code on screen when a poll fails', async () => {
      let calls = 0;
      stubApi({
        igLinkStatus: vi.fn(async () => {
          calls += 1;
          if (calls === 1) return { linked: false as const };
          throw new Error('network down');
        }),
      });
      await render();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button.primary')?.click();
      });
      await flush();
      await advance(4000);
      expect(host.querySelector('.pair-code')?.textContent).toBe('ABCD2345');
    });

    it('checks again the moment the tab becomes visible', async () => {
      const { box, spy } = flipSpy();
      stubApi({ igLinkStatus: spy });
      await render();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button.primary')?.click();
      });
      await flush();
      const before = spy.mock.calls.length;

      // The user switches to Instagram, sends the DM, and comes back.
      box.linked = true;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await advance(0);

      expect(spy.mock.calls.length).toBeGreaterThan(before);
      expect(host.textContent).toContain('@paired');
    });
  });
});
