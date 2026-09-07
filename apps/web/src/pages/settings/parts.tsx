import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Link, navigate } from '../../router';

/**
 * Building blocks of the grouped-settings idiom (iOS/Android settings list): a group is a
 * labelled card of rows; a row is label + value on the right (+ chevron when it navigates).
 * Every page under /settings/<section> shares SettingsPage for its back header.
 */

export function SettingsPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page narrow settings stack loose">
      <div className="page-head">
        <button
          type="button"
          className="ghost icon"
          onClick={() => navigate('/settings')}
          aria-label="Back to settings"
        >
          <Icon name="arrow-left" />
        </button>
        <h2>{title}</h2>
      </div>
      {intro && <p className="help lede">{intro}</p>}
      {children}
    </div>
  );
}

export function Group({
  title,
  children,
  foot,
}: {
  title?: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <section className="sgroup">
      {title && <h3 className="sgroup-title">{title}</h3>}
      <div className="sgroup-body">{children}</div>
      {foot && <p className="help sgroup-foot">{foot}</p>}
    </section>
  );
}

/**
 * One settings row. With `to` it is a link with a chevron; with `onClick` a button; else a
 * static label/value pair. `control` puts a form control (switch, select) on the right.
 */
export function Row({
  icon,
  label,
  hint,
  value,
  to,
  onClick,
  control,
  danger = false,
  status,
  external = false,
}: {
  icon?: IconName | undefined;
  label: ReactNode;
  hint?: ReactNode | undefined;
  value?: ReactNode | undefined;
  to?: string;
  /** With `to`: open in a new tab instead of routing in-app. */
  external?: boolean;
  onClick?: () => void;
  control?: ReactNode;
  danger?: boolean;
  /** Small dot before the value: ok / warn / err. */
  status?: 'ok' | 'warn' | 'err' | undefined;
}) {
  const inner = (
    <>
      {icon && <Icon name={icon} className="srow-icon" />}
      <span className="srow-text">
        <span className="srow-label">{label}</span>
        {hint && <span className="srow-hint">{hint}</span>}
      </span>
      {(value !== undefined || status) && (
        <span className="srow-value">
          {status && <span className={`dot ${status}`} aria-hidden="true" />}
          {value}
        </span>
      )}
      {control && <span className="srow-control">{control}</span>}
      {to && (
        <Icon name={external ? 'external-link' : 'chevron-right'} className="srow-chev" size={18} />
      )}
    </>
  );
  const cls = `srow${danger ? ' danger' : ''}`;
  if (to && external)
    return (
      <a href={to} className={cls} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  // The control carries its own accessible name (aria-label / legend), so a plain div suffices.
  if (control) return <div className={`${cls} has-control`}>{inner}</div>;
  return <div className={cls}>{inner}</div>;
}

/** A two-state switch (checkbox styled as a toggle); the label comes from the enclosing Row. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      aria-checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** Segmented choice for a handful of options (theme, prose size). */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <fieldset className="segmented compact">
      <legend className="sr-only">{name}</legend>
      {options.map((o) => (
        <label key={o.id} className="segment" data-on={o.id === value ? '' : undefined}>
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={o.id === value}
            onChange={() => onChange(o.id)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Inline status line under a group's actions (`role="status"` so screen readers hear it). */
export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) {
  if (!children) return null;
  return (
    <p className={`msg-inline${error ? ' err' : ''}`} role="status">
      {children}
    </p>
  );
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
