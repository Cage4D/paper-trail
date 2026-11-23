import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { IconLoader2 } from '@tabler/icons-react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** In flight: aria-busy, spinner, progress label; clicks are ignored (never `disabled`). */
  busy?: boolean;
  busyLabel?: ReactNode;
  full?: boolean;
  children: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, busy, busyLabel, full, className, onClick, children, type = 'button', ...rest }: Props) {
  const cls = ['pt-btn', variant !== 'secondary' && `pt-btn--${variant}`, size !== 'md' && `pt-btn--${size}`, full && 'pt-btn--full', className].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      aria-busy={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {busy ? <IconLoader2 size={18} stroke={2} className="pt-spin" aria-hidden /> : icon}
      <span>{busy && busyLabel ? busyLabel : children}</span>
      {!busy && iconRight}
    </button>
  );
}
