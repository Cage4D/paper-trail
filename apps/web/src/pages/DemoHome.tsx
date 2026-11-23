import { Link } from 'react-router';
import { IconArrowRight } from '@tabler/icons-react';
import envelope from '../assets/stickers/sealed-envelope.svg';
import { Button } from '../components/Button';
import { AppPage } from '../components/Shell';
import { StartError } from '../components/StartError';
import { useElapsed } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
import { startStage, useStartDemo } from '../lib/useStartDemo';

/** /demo: the nav's "Demo" link always lands here. Start a demo, or continue this tab's last one. */
export function DemoHome() {
  const { start, busy, error } = useStartDemo();
  const s = useElapsed(busy);
  const recent = getRecentDemo();
  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 24, maxWidth: 820, marginLeft: 'auto', marginRight: 'auto' }}>
        <img src={envelope} alt="" aria-hidden="true" className="pt-empty__art" />
        <h1 className="pt-h1 pt-h1--xl">The 3-minute demo</h1>
        <p className="pt-lead">
          Play Examiner 2 in a real exam on the QoreChain practice blockchain. You'll see each centre's copy is different, try to open the paper too early, unlock it with two keys, remove a member of staff, and trace a leaked copy back to its centre.
        </p>
        <p className="pt-muted">No wallet, keys or funds needed. The server holds the demo keys and bots play everyone else. Practice blockchain (testnet) only.</p>
        <div className="pt-row" style={{ gap: 16 }}>
          <Button variant="primary" size="lg" onClick={start} busy={busy} busyLabel={`${startStage(s).label} ${s} s`} iconRight={<IconArrowRight size={20} stroke={2} aria-hidden />}>
            Start the 3-minute demo
          </Button>
          {recent && (
            <Link className="pt-btn pt-btn--lg" to={`/demo/${recent.demoId}`}>
              Continue your demo
            </Link>
          )}
        </div>
        {error && <StartError code={error.code} message={error.message} onRetry={start} />}
      </section>
    </AppPage>
  );
}
