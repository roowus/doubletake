import { Toast } from '@base-ui/react/toast';
import { Icon } from './Icon';

/**
 * Transient confirmations ("Link copied", "Disconnected."): Base UI Toast, one manager for
 * the whole app so pages call `toast('…')` without hooks. Errors never go here; they stay
 * inline next to the thing that failed with `role="alert"`.
 */
const manager = Toast.createToastManager();

export function toast(title: string, description?: string) {
  return manager.add({ title, ...(description ? { description } : {}), type: 'success' });
}

/** Mounted once in the shell. Bottom of the screen, above the tab bar and safe area. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={manager} timeout={4000} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="toasts" aria-label="Notifications">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root key={t.id} toast={t} className="toast">
      <Icon name="check" size={16} className="toast-icon" />
      <Toast.Content className="toast-body">
        <Toast.Title className="toast-title" />
        {t.description && <Toast.Description className="toast-desc" />}
      </Toast.Content>
      <Toast.Close className="ghost icon small" aria-label="Dismiss">
        <Icon name="x" size={16} />
      </Toast.Close>
    </Toast.Root>
  ));
}
