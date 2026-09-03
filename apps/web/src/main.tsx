import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNative } from './native';
import './styles.css';

if ('serviceWorker' in navigator) {
  if (isNative()) {
    // Never run the PWA worker inside Capacitor; drop one left by an earlier build.
    void navigator.serviceWorker
      .getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      .catch(() => undefined);
  } else {
    void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
