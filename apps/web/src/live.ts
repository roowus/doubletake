import { useEffect, useRef } from 'react';
import { type LiveEvent, subscribeLive } from './api';

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let unsubscribe: (() => void) | null = null;

function ensure() {
  if (unsubscribe) return;
  unsubscribe = subscribeLive((e) => {
    for (const l of listeners) l(e);
  });
}

export function resetLive(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (listeners.size > 0) ensure();
}

/** Subscribe a component to live server events (one shared WebSocket). */
export function useLive(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    ensure();
    return () => {
      listeners.delete(l);
    };
  }, []);
}
