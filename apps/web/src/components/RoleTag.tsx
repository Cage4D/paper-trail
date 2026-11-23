import type { ReactNode } from 'react';
import { IconBuildingBank, IconChecklist, IconEye, IconPencil, IconUser } from '@tabler/icons-react';

export type RoleKind = 'board' | 'examiner' | 'invigilator' | 'marker' | 'candidate';
const DOT: Record<RoleKind, { bg: string; icon: ReactNode }> = {
  board: { bg: 'var(--highlight)', icon: <IconBuildingBank size={13} stroke={2} /> },
  examiner: { bg: 'var(--sticker-pink)', icon: <IconPencil size={13} stroke={2} /> },
  invigilator: { bg: 'var(--sticker-lavender)', icon: <IconEye size={13} stroke={2} /> },
  marker: { bg: 'var(--sticker-mint)', icon: <IconChecklist size={13} stroke={2} /> },
  candidate: { bg: '#ffffff', icon: <IconUser size={13} stroke={2} /> },
};

export const roleKindOf = (role: string): RoleKind =>
  role.startsWith('examiner') ? 'examiner' : role.startsWith('invigilator') ? 'invigilator' : role.startsWith('marker') ? 'marker' : role === 'board' ? 'board' : 'candidate';

/** Who is acting: a role dot (identity, not state) and the role label. */
export function RoleTag({ kind, children }: { kind: RoleKind; children: ReactNode }) {
  const d = DOT[kind];
  return (
    <span className="pt-role">
      <span className="pt-role__dot" style={{ background: d.bg }} aria-hidden>
        {d.icon}
      </span>
      {children}
    </span>
  );
}
