// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { Welcome } from './Welcome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The button that submits the welcome form (password, pairing code, or first-run setup). */
function submitButton(host: HTMLElement): HTMLButtonElement {
  const form = host.querySelector('form.welcome');
  const btn = form?.querySelector('button[type="submit"]');
  if (!btn) throw new Error('no submit button rendered');
  return btn as HTMLButtonElement;
}

describe('Welcome', () => {
  let host: HTMLDivElement;
  let root: Root;

  // A fresh root per test: the mount effect only re-runs when `native` changes, so reusing a
  // root would carry the previous test's state into the next one.
  function render() {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Welcome onAuthed={() => {}} />);
    });
  }

  /** Let the health promise settle and the resulting state update land. */
  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.restoreAllMocks();
  });

  it('leaves the submit button usable when the health probe fails', async () => {
    // Regression: a failed probe used to leave `hasOwner` null, which disabled the button
    // forever even though pairing never needs the owner state. The phone showed a dead
    // "Pair this device" button and an unreachable-server banner.
    vi.spyOn(api, 'health').mockRejectedValue(new Error('network down'));
    render();
    await settle();
    expect(host.textContent).toContain('Cannot reach the Doubletake server.');
    expect(submitButton(host).disabled).toBe(false);
  });

  it('offers both password and pairing code once the probe reports an owner', async () => {
    vi.spyOn(api, 'health').mockResolvedValue({ hasOwner: true } as Awaited<
      ReturnType<typeof api.health>
    >);
    render();
    await settle();
    expect(host.textContent).toContain('Open your notebook');
    expect(submitButton(host).disabled).toBe(false);
  });
});
