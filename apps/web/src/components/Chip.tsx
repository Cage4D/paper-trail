import type { ReactNode } from 'react';
import {
  IconAlertTriangle, IconCheck, IconFlask, IconKey, IconLock, IconLockOpen, IconRefresh, IconRosetteDiscountCheck, IconUserOff, IconX,
} from '@tabler/icons-react';

export type ChipStatus = 'sealed' | 'pending' | 'released' | 'done' | 'authentic' | 'epoch' | 'revoked' | 'leak' | 'failed' | 'demo';

const ICON: Record<ChipStatus, ReactNode> = {
  sealed: <IconLock size={15} stroke={2} aria-hidden />,
  pending: <IconKey size={15} stroke={2} aria-hidden />,
  released: <IconLockOpen size={15} stroke={2} aria-hidden />,
  done: <IconCheck size={15} stroke={2} aria-hidden />,
  authentic: <IconRosetteDiscountCheck size={15} stroke={2} aria-hidden />,
  epoch: <IconRefresh size={15} stroke={2} aria-hidden />,
  revoked: <IconUserOff size={15} stroke={2} aria-hidden />,
  leak: <IconAlertTriangle size={15} stroke={2} aria-hidden />,
  failed: <IconX size={15} stroke={2} aria-hidden />,
  demo: <IconFlask size={15} stroke={2} aria-hidden />,
};

/** StatusChip: fill + icon + word, never colour alone. */
export function Chip({ status, icon, children, className }: { status: ChipStatus; icon?: ReactNode | null; children: ReactNode; className?: string }) {
  const cls = status === 'done' ? 'released' : status;
  return (
    <span className={`pt-chip pt-chip--${cls}${className ? ` ${className}` : ''}`}>
      {icon === null ? null : (icon ?? ICON[status])}
      {children}
    </span>
  );
}
