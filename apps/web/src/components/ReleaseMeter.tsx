import { IconKey } from '@tabler/icons-react';

/** 2-of-3 release as two key slots: dashed → highlight → both mint once Released. */
export function ReleaseMeter({ count, released, epoch, centre, mini = false }: { count: number; released: boolean; epoch?: number; centre?: string; mini?: boolean }) {
  const n = Math.min(2, Math.max(0, released ? 2 : count));
  const text = released ? `Released${epoch ? ` · epoch ${epoch}` : ''}` : `${centre ? `${centre} · ` : ''}${n} of 2 released`;
  if (mini)
    return (
      <span className="pt-minimeter" aria-label={released ? 'Released, 2 of 2' : `${n} of 2 released`}>
        {[0, 1].map((i) => (
          <span key={i} className={`pt-minimeter__key${i < n ? ' pt-minimeter__key--on' : ''}${released ? ' pt-minimeter__key--done' : ''}`} aria-hidden />
        ))}
        <span className="pt-minimeter__text">{n} of 2</span>
      </span>
    );
  return (
    <div className={`pt-meter${released ? ' pt-meter--done' : ''}`}>
      <div className="pt-meter__keys" aria-hidden>
        {[0, 1].map((i) => (
          <span key={i} className={`pt-meter__key${i < n ? ' pt-meter__key--on' : ''}`}>
            <IconKey size={24} stroke={2} />
          </span>
        ))}
      </div>
      <span className="pt-meter__text">{text}</span>
    </div>
  );
}
