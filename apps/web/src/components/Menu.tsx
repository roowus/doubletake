import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuAction = {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
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
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: (MenuAction | 'separator')[];
  align?: 'start' | 'end' | 'center';
  className?: string;
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className={className ?? 'ghost icon'} aria-label={label}>
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="menu-positioner" side="bottom" align={align} sideOffset={6}>
          <BaseMenu.Popup className="menu">
            {items.map((it, i) =>
              it === 'separator' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
                <BaseMenu.Separator key={`sep-${i}`} className="menu-sep" />
              ) : (
                <BaseMenu.Item
                  key={it.label}
                  className={`menu-item${it.danger ? ' danger' : ''}`}
                  disabled={it.disabled}
                  onClick={it.onSelect}
                >
                  {it.icon && <Icon name={it.icon} size={16} />}
                  {it.label}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
