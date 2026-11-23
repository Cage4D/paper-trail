import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** Label above, help below; an error replaces the help text and turns the input coral. */
export function Field({ label, help, error, children, className }: { label: ReactNode; help?: ReactNode; error?: ReactNode; children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>; className?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  const input = isValidElement(children) ? cloneElement(children, { id, 'aria-describedby': help || error ? helpId : undefined, 'aria-invalid': error ? true : undefined }) : children;
  return (
    <div className={`pt-field${error ? ' pt-field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {input}
      {(error || help) && (
        <p className="pt-field__help" id={helpId} role={error ? 'alert' : undefined}>
          {error ?? help}
        </p>
      )}
    </div>
  );
}
