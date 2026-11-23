import type { ReactNode } from 'react';
import { IconAlertTriangle, IconCircleCheck, IconClock, IconFlask, IconInfoCircle } from '@tabler/icons-react';

type Tone = 'wait' | 'ok' | 'error' | 'info' | 'demo';
const ICON: Record<Tone, ReactNode> = {
  wait: <IconClock size={20} stroke={2} aria-hidden />,
  ok: <IconCircleCheck size={20} stroke={2} aria-hidden />,
  error: <IconAlertTriangle size={20} stroke={2} aria-hidden />,
  info: <IconInfoCircle size={20} stroke={2} aria-hidden />,
  demo: <IconFlask size={20} stroke={2} aria-hidden />,
};

/** Flat feedback strip. Error-catalog messages go in verbatim. */
export function Banner({ tone, icon, children, action, wide = true }: { tone: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode; wide?: boolean }) {
  return (
    <div className={`pt-banner pt-banner--${tone}${wide ? ' pt-banner--wide' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {icon ?? ICON[tone]}
      <div className="pt-banner__body">
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

/** Grey honesty / explanation note. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="pt-note">
      <IconInfoCircle size={18} stroke={2} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
