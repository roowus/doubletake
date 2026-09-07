import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuAction = {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a check mark: the item is the current choice of a mutually exclusive set. */
  checked?: boolean;
  /** Small muted text at the right edge (a duration, a shortcut). */
  hint?: string;
};

/**
 * Overflow / action menu (Base UI Menu): keyboard navigable, typeahead, closes on select,
 * positioned below the trigger. `trigger` is the button contents; give it an aria-label
 * when it is icon-only.
 */
export function Menu({
  label,
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  className,
  heading,
}: {
  label: string;
  trigger: ReactNode;
  items: (MenuAction | 'separator' | { heading: string })[];
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  className?: string;
  /** Optional title line at the top of the popup. */
  heading?: string;
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className={className ?? 'ghost icon'} aria-label={label}>
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="menu-positioner" side={side} align={align} sideOffset={6}>
          <BaseMenu.Popup className="menu">
            {heading && <div className="menu-heading">{heading}</div>}
            {items.map((it, i) =>
              it === 'separator' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
                <BaseMenu.Separator key={`sep-${i}`} className="menu-sep" />
              ) : 'heading' in it ? (
                <div key={it.heading} className="menu-heading" role="presentation">
                  {it.heading}
                </div>
              ) : (
                <BaseMenu.Item
                  key={it.label}
                  className={`menu-item${it.danger ? ' danger' : ''}${it.checked != null ? ' checkable' : ''}`}
                  disabled={it.disabled}
                  aria-checked={it.checked}
                  onClick={it.onSelect}
                >
                  {it.checked != null ? (
                    <Icon name="check" size={16} className={it.checked ? '' : 'hidden-check'} />
                  ) : (
                    it.icon && <Icon name={it.icon} size={16} />
                  )}
                  <span className="grow">{it.label}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
