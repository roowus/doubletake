// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  createChannel: vi.fn(async () => {}),
  register: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({})) } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(), remove: vi.fn() },
}));
const token = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('./api', () => ({ api: {}, getToken: () => token.value }));
vi.mock('./router', () => ({ navigate: vi.fn() }));

import { resumeNativePush } from './native';

describe('resumeNativePush', () => {
  beforeEach(() => {
    push.checkPermissions.mockReset();
    push.register.mockClear();
    push.createChannel.mockClear();
  });

  it('does nothing while unpaired', async () => {
    token.value = null;
    push.checkPermissions.mockResolvedValue({ receive: 'granted' });
    expect(await resumeNativePush()).toBe(false);
    expect(push.register).not.toHaveBeenCalled();
  });

  it('never prompts: skips when permission is not already granted', async () => {
    token.value = 'dt_x';
    push.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    expect(await resumeNativePush()).toBe(false);
    expect(push.register).not.toHaveBeenCalled();
  });

  it('re-registers (channel + register) when paired and permitted', async () => {
    token.value = 'dt_x';
    push.checkPermissions.mockResolvedValue({ receive: 'granted' });
    expect(await resumeNativePush()).toBe(true);
    expect(push.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'doubletake' }));
    expect(push.register).toHaveBeenCalledTimes(1);
  });

  it('swallows plugin failures', async () => {
    token.value = 'dt_x';
    push.checkPermissions.mockRejectedValue(new Error('no play services'));
    expect(await resumeNativePush()).toBe(false);
  });
});
