import { Link } from 'react-router';
import { getRecentDemo } from '../lib/recent';
import { Banner } from './Banner';
import { Button } from './Button';

/** What went wrong starting a demo, with the right next step (never an instant retry on TIMEOUT). */
export function StartError({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  const recent = getRecentDemo();
  if (code === 'TIMEOUT')
    return (
      <Banner tone="wait" action={recent && <Link className="pt-btn pt-btn--sm" to={`/demo/${recent.demoId}`}>Open the last demo</Link>}>
        This is taking much longer than usual. The demo may still have been created on QoreChain, but this page never got its id. Starts are limited to 5 per hour, so wait a minute or two before starting another.
      </Banner>
    );
  if (code === 'RATE_LIMITED')
    return (
      <Banner tone="error" action={recent && <Link className="pt-btn pt-btn--sm" to={`/demo/${recent.demoId}`}>Open the last demo</Link>}>
        {message} The demo is limited to 5 runs per hour. Open the last demo instead.
      </Banner>
    );
  const retryable = ['CHAIN_UNAVAILABLE', 'INTERNAL', 'NETWORK', 'TIMEOUT', 'RELAYER_BUSY'].includes(code);
  return (
    <Banner tone="error" action={retryable && <Button size="sm" onClick={onRetry}>Try again</Button>}>
      {message}
    </Banner>
  );
}
