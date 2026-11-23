import type { ReactNode } from 'react';

/**
 * A handwritten sticky note: pale yellow paper, taped on, slightly tilted. Playful asides only;
 * never for the required honesty notes (those use Note). Paper-coloured in both themes.
 */
export function StickyNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside className={`pt-sticky${className ? ` ${className}` : ''}`}>
      <span className="pt-sticky__tape" aria-hidden />
      <p className="pt-sticky__text">{children}</p>
    </aside>
  );
}
