import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Bottom sheet on phones, centred dialog from 768 px. Base UI Dialog does the focus trap,
 * escape/backdrop dismissal and aria wiring; styles.css draws it (`.sheet*`) and animates
 * with the `data-starting-style` / `data-ending-style` attributes Base UI sets.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Popup className="sheet">
          <header className="sheet-head">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="ghost icon" aria-label="Close">
              <Icon name="x" size={20} />
            </Dialog.Close>
          </header>
          {description && (
            <Dialog.Description className="sheet-desc muted">{description}</Dialog.Description>
          )}
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-foot">{footer}</footer>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
