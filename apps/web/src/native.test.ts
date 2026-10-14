// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  fcmErrorMessage,
  HOSTED_URL,
  isLocalBundleOrigin,
  nativeEntryUrl,
  nativeShareChannel,
  parsePairingInput,
  pendingShareToPath,
  sessionPrefs,
  targetPath,
} from './native';

describe('parsePairingInput', () => {
  it('accepts the QR URL form', () => {
    expect(parsePairingInput('https://mac.tail1234.ts.net/?code=ab12cd')).toEqual({
      url: 'https://mac.tail1234.ts.net',
      code: 'ab12cd',
    });
  });
  it('accepts the JSON form', () => {
    expect(parsePairingInput('{"url":"https://h.ts.net","code":"XY"}')).toEqual({
      url: 'https://h.ts.net',
      code: 'XY',
    });
  });
  it('treats anything else as a bare code, upper-cased', () => {
    expect(parsePairingInput(' k9m2pq ')).toEqual({ code: 'K9M2PQ' });
    expect(parsePairingInput('')).toEqual({});
  });
});

describe('targetPath', () => {
  it('prefers chatId, then the path of url, then root', () => {
    expect(targetPath({ chatId: 'c1', url: 'https://h/chat/other' })).toBe('/chat/c1');
    expect(targetPath({ url: 'https://h.ts.net/chat/c2' })).toBe('/chat/c2');
    expect(targetPath({ url: '/chat/c3' })).toBe('/chat/c3');
    expect(targetPath({})).toBe('/');
  });
});

describe('pendingShareToPath', () => {
  it('carries url/text/title and marks the android_share channel', () => {
    const p = pendingShareToPath({ url: 'https://x.com/a/status/1', title: 'T' }, 'android_share');
    const u = new URL(p, 'https://localhost');
    expect(u.pathname).toBe('/share');
    expect(u.searchParams.get('url')).toBe('https://x.com/a/status/1');
    expect(u.searchParams.get('title')).toBe('T');
    expect(u.searchParams.get('channel')).toBe('android_share');
  });
  it('records ios_share for the iOS extension', () => {
    const u = new URL(pendingShareToPath({ text: 'hi' }, 'ios_share'), 'https://localhost');
    expect(u.searchParams.get('channel')).toBe('ios_share');
  });
});

describe('nativeShareChannel', () => {
  it('maps the Capacitor platform to the channel enum', () => {
    expect(nativeShareChannel('ios')).toBe('ios_share');
    expect(nativeShareChannel('android')).toBe('android_share');
    expect(nativeShareChannel('web')).toBe('android_share');
  });
});

describe('fcmErrorMessage', () => {
  it('explains SERVICE_NOT_AVAILABLE as a reachability problem', () => {
    const m = fcmErrorMessage({
      error: 'java.util.concurrent.ExecutionException: java.io.IOException: SERVICE_NOT_AVAILABLE',
    });
    expect(m).toMatch(/could not reach Firebase/);
    expect(m).toMatch(/DNS/);
  });
  it('points at the missing Firebase config', () => {
    expect(fcmErrorMessage({ error: 'Default FirebaseApp is not initialized' })).toMatch(
      /google-services\.json/,
    );
  });
  it('falls back to the raw message', () => {
    expect(fcmErrorMessage({ error: 'boom' })).toBe('FCM registration failed: boom');
    expect(fcmErrorMessage(undefined)).toBe('FCM registration failed: unknown error');
  });
});

describe('hosted default', () => {
  it('is the hosted service, not a URL the owner has to type', () => {
    expect(HOSTED_URL).toBe('https://doubletake.gg');
  });

  it('leaves the app on the served page when it is already a real server', () => {
    // The Capacitor bundle is served from a local origin; the hosted login is not.
    expect(nativeEntryUrl('https://localhost', null)).toBe(HOSTED_URL);
    expect(nativeEntryUrl('capacitor://localhost', null)).toBe(HOSTED_URL);
    expect(nativeEntryUrl('https://doubletake.gg', null)).toBe('https://doubletake.gg');
    expect(nativeEntryUrl('https://mac.tail1234.ts.net', null)).toBe('https://mac.tail1234.ts.net');
  });

  it('honours a stored override only when it is the page it is on', () => {
    // A dev build pointed at a local server: stay where we are.
    expect(nativeEntryUrl('http://127.0.0.1:7391', null)).toBe('http://127.0.0.1:7391');
    // A stored self-hosted URL cannot redirect the hosted login page to another origin.
    expect(nativeEntryUrl('https://doubletake.gg', 'https://mac.tail1234.ts.net')).toBe(
      'https://doubletake.gg',
    );
    // …but it is respected when that is where the WebView actually is.
    expect(nativeEntryUrl('https://mac.tail1234.ts.net/', 'https://mac.tail1234.ts.net')).toBe(
      'https://mac.tail1234.ts.net',
    );
  });

  it('knows the two origins the bundle is served from', () => {
    expect(isLocalBundleOrigin('https://localhost')).toBe(true);
    expect(isLocalBundleOrigin('capacitor://localhost/')).toBe(true);
    expect(isLocalBundleOrigin('https://doubletake.gg')).toBe(false);
    expect(isLocalBundleOrigin('https://localhost.evil.test')).toBe(false);
  });
});

describe('sessionPrefs', () => {
  it('records the hosted origin and the dth_ session for the share sheet', () => {
    expect(sessionPrefs({ hostedOrigin: HOSTED_URL, token: 'dth_abc' })).toEqual([
      { key: 'doubletake.hosted', value: HOSTED_URL },
      { key: 'doubletake.serverUrl', value: '' },
      { key: 'doubletake.hostedToken', value: 'dth_abc' },
    ]);
  });

  it('keeps a self-hosted pairing untouched, so the choice survives a hosted sign-in', () => {
    expect(sessionPrefs({ token: null })).toEqual([
      { key: 'doubletake.hosted', value: '' },
      { key: 'doubletake.serverUrl', value: '' },
      { key: 'doubletake.token', value: '' },
    ]);
    expect(sessionPrefs({ serverUrl: 'https://mac.tail1234.ts.net/', token: 'dt_x' })).toEqual([
      { key: 'doubletake.hosted', value: '' },
      { key: 'doubletake.serverUrl', value: 'https://mac.tail1234.ts.net' },
      { key: 'doubletake.token', value: 'dt_x' },
    ]);
  });
});

describe('native bridge on the web', () => {
  it('writes nothing through the plugin when the app is not native', async () => {
    const set = vi.fn();
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
    }));
    vi.doMock('@capacitor/preferences', () => ({
      Preferences: { set, remove: vi.fn(), get: vi.fn() },
    }));
    vi.doMock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
    vi.doMock('@capacitor/push-notifications', () => ({ PushNotifications: {} }));
    const mod = await import('./native');
    mod.setServerUrl('https://mac.tail1234.ts.net');
    mod.mirrorToken('dth_abc');
    await mod.mirrorPreferences('doubletake.hosted', HOSTED_URL);
    expect(set).not.toHaveBeenCalled();
    expect(mod.apiBase()).toBe('');
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('@capacitor/preferences');
    vi.doUnmock('@capacitor/app');
    vi.doUnmock('@capacitor/push-notifications');
    vi.resetModules();
  });

  it('writes the keys through Preferences when the app is native', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    }));
    vi.doMock('@capacitor/preferences', () => ({ Preferences: { set, remove, get: vi.fn() } }));
    vi.doMock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
    vi.doMock('@capacitor/push-notifications', () => ({ PushNotifications: {} }));
    const mod = await import('./native');
    mod.setServerUrl('https://mac.tail1234.ts.net');
    mod.mirrorToken('dth_abc');
    expect(mod.apiBase()).toBe('https://mac.tail1234.ts.net');
    // Choosing a server is what leaves hosted mode, and a sign-out clears both sessions.
    mod.mirrorToken(null);
    mod.setServerUrl(null);
    await mod.mirrorPreferences('doubletake.hosted', HOSTED_URL);
    expect(set).toHaveBeenCalledWith({
      key: 'doubletake.serverUrl',
      value: 'https://mac.tail1234.ts.net',
    });
    expect(remove).toHaveBeenCalledWith({ key: 'doubletake.serverUrl' });
    expect(remove).toHaveBeenCalledWith({ key: 'doubletake.hosted' }); // setServerUrl(url): hosted off
    expect(set).toHaveBeenCalledWith({ key: 'doubletake.hostedToken', value: 'dth_abc' });
    expect(remove).toHaveBeenCalledWith({ key: 'doubletake.hostedToken' }); // mirrorToken(null)
    expect(remove).toHaveBeenCalledWith({ key: 'doubletake.token' }); // mirrorToken(null)
    expect(set).toHaveBeenCalledWith({ key: 'doubletake.hosted', value: HOSTED_URL });
    expect(mod.apiBase()).toBe('');
    vi.unstubAllGlobals();
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('@capacitor/preferences');
    vi.doUnmock('@capacitor/app');
    vi.doUnmock('@capacitor/push-notifications');
    vi.resetModules();
  });
});
