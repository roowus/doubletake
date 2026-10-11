// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Login } from './Login';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hosted = { hosted: true, inviteRequired: false };
const inviteOnly = { hosted: true, inviteRequired: true };

describe('Login', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  function render(props: Partial<React.ComponentProps<typeof Login>> = {}) {
    act(() => {
      root.render(
        <Login
          hosted={hosted}
          oauthError={null}
          returnTo="/library"
          onAuthed={() => {}}
          {...props}
        />,
      );
    });
  }

  it('renders e-mail and password with a Google sign-in and no invite field', () => {
    render();
    expect(document.getElementById('h-email')).not.toBeNull();
    expect(document.getElementById('h-pass')).not.toBeNull();
    expect(document.getElementById('h-invite')).toBeNull();
    expect(host.textContent).toContain('Sign in with Google');
    expect(host.textContent).not.toContain('Invite code');
  });

  it('shows the invite field on Register only when the instance is invite-only', () => {
    render();
    act(() => host.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')?.click());
    expect(document.getElementById('h-invite')).toBeNull();
    render({ hosted: inviteOnly });
    act(() => host.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')?.click());
    expect(document.getElementById('h-invite')).not.toBeNull();
  });

  it('surfaces an OAuth error from the callback as an alert', () => {
    render({ oauthError: 'Google sign-in failed' });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Google sign-in failed');
  });

  it('disables submit until both fields are filled', () => {
    render();
    const submit = () =>
      host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled;
    expect(submit()).toBe(true);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      const set = (id: string, v: string) => {
        const el = document.getElementById(id) as HTMLInputElement;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('h-email', 'owner@example.test');
      set('h-pass', 'secret123');
    });
    expect(submit()).toBe(false);
  });
});
