import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The WebView loads the built PWA from the app bundle (webDir) and talks to the owner's server
 * at the URL stored during pairing, so the same bundle works for every self-hosted instance.
 */
const config: CapacitorConfig = {
  appId: 'com.roowus.doubletake',
  appName: 'Doubletake',
  webDir: '../web/dist',
  android: {
    // Enable `chrome://inspect` for debug builds only.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
