// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster, toast } from './Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Toaster', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  afterEach(() => act(() => root.unmount()));

  it('shows a toast added from anywhere via the module-level manager', async () => {
    await act(async () => root.render(<Toaster />));
    await act(async () => {
      toast('Link copied', 'https://example.test/c/abc');
    });
    const region = document.querySelector('.toasts');
    expect(region?.getAttribute('aria-label')).toBe('Notifications');
    expect(document.body.textContent).toContain('Link copied');
    expect(document.body.textContent).toContain('https://example.test/c/abc');
    expect(document.querySelector('.toast [aria-label="Dismiss"]')).not.toBeNull();
  });
});
