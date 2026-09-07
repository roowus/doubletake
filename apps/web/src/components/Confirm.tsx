import { AlertDialog } from '@base-ui/react/alert-dialog';
import type { ReactNode } from 'react';

/**
 * Confirmation for destructive actions (Base UI AlertDialog: modal, no backdrop dismissal,
 * focus lands on the cancel button). Render it controlled: `open` + `onOpenChange`.
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  action,
  onConfirm,
  danger = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: ReactNode;
  action: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="sheet-backdrop" />
        <AlertDialog.Popup className="sheet confirm">
          <AlertDialog.Title className="sheet-title">{title}</AlertDialog.Title>
          {body && (
            <AlertDialog.Description className="sheet-desc muted">{body}</AlertDialog.Description>
          )}
          <div className="sheet-foot">
            <AlertDialog.Close className="ghost">Cancel</AlertDialog.Close>
            <button
              type="button"
              className={danger ? 'danger solid' : 'primary'}
              onClick={() => {
                void onConfirm();
                onOpenChange(false);
              }}
            >
              {action}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
