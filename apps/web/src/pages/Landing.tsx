import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { IconArrowRight, IconFlask, IconMenu2, IconX } from '@tabler/icons-react';
import envelope from '../assets/stickers/sealed-envelope.svg';
import key from '../assets/stickers/key.svg';
import keyRing from '../assets/stickers/key-ring.svg';
import canary from '../assets/stickers/canary.svg';
import padlock from '../assets/stickers/padlock.svg';
import stamp from '../assets/stickers/authentic-stamp.svg';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Footer, ThemeToggle } from '../components/Shell';
import { StickyNote } from '../components/StickyNote';
import { REPO_URL } from '../lib/config';
import { useElapsed } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
import { START_STEPS, startStage, useStartDemo } from '../lib/useStartDemo';

const EXAM_ID = /^0x[0-9a-fA-F]{64}$/;

function NavBar({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const links = (
    <>
      <a href="#how">How it works</a>
      <Link to="/audit">Audit trail</Link>
      <Link to="/verify">Verify a paper</Link>
      <Link to="/marks">Check my mark</Link>
      <a href={REPO_URL} target="_blank" rel="noreferrer">
        GitHub
      </a>
    </>
  );
  return (
    <>
      <nav className="pt-nav pt-landnav" aria-label="Main">
        <Link className="pt-nav__brand" to="/">
          paper trail
        </Link>
        <div className="pt-nav__links pt-desktop">
          {links}
          <ThemeToggle />
        </div>
        <button type="button" className="pt-menubtn pt-phone" aria-expanded={open} aria-controls="pt-landsheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <IconX size={24} stroke={2} aria-hidden /> : <IconMenu2 size={24} stroke={2} aria-hidden />}
        </button>
        <button type="button" className="pt-nav__cta" onClick={onStart} aria-busy={busy || undefined}>
          <span className="pt-desktop-inline">{busy ? 'Setting up…' : 'Start the demo'}</span>
          <span className="pt-phone-inline">{busy ? '…' : 'Demo'}</span>
        </button>
      </nav>
      {open && (
        <div id="pt-landsheet" className="pt-sheetmenu pt-phone" onClick={() => setOpen(false)}>
          <nav aria-label="Main">{links}</nav>
          <div className="pt-sheetmenu__tools" onClick={(e) => e.stopPropagation()}>
            <span className="pt-small pt-muted">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </>
  );
}

function StartError({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
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

function AuditCard() {
  const navigate = useNavigate();
  const recent = getRecentDemo();
  const [id, setId] = useState(recent?.examId ?? '');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = id.trim();
    if (!EXAM_ID.test(v)) return setErr('Enter an exam id: 0x followed by 64 hex characters.');
    navigate(`/exams/${v.toLowerCase()}/audit`);
  };
  return (
    <form className="pt-card pt-toolcard" onSubmit={submit} noValidate>
      <h3 className="pt-h3">View an exam's audit trail</h3>
      <p className="pt-toolcard__text">Every on-chain event for one exam, with explorer links.</p>
      <Field label="Exam id" error={err} className="pt-field--flex">
        <input className="pt-input pt-input--mono" value={id} onChange={(e) => (setId(e.target.value), setErr(null))} placeholder="0x8c41f2…" spellCheck={false} autoComplete="off" />
      </Field>
      <button type="submit" className="pt-btn" style={{ alignSelf: 'flex-start' }}>
        Open audit trail
      </button>
    </form>
  );
}

export function Landing() {
  const { start, busy, error } = useStartDemo();
  const s = useElapsed(busy);
  const stage = startStage(s);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <div className="pt-page pt-landing">
      <NavBar onStart={start} busy={busy} />
      <main id="main" className="pt-main">
        <header className="pt-hero">
          <img src={envelope} alt="" aria-hidden="true" className="pt-hero__art pt-hero__art--envelope" />
          <img src={key} alt="" aria-hidden="true" className="pt-hero__art pt-hero__art--key" />
          <img src={canary} alt="" aria-hidden="true" className="pt-hero__art pt-hero__art--canary" />
          <img src={padlock} alt="" aria-hidden="true" className="pt-hero__art pt-hero__art--padlock" />
          <div className="pt-wrap pt-hero__body">
            <span className="pt-chip pt-chip--demo">
              <IconFlask size={15} stroke={2} aria-hidden />
              Live on QoreChain testnet
            </span>
            <h1 className="pt-hero__title">
              A post-quantum chain of custody for <span className="pt-hl">exam papers</span>.
            </h1>
            <p className="pt-hero__sub">
              Every centre gets its own sealed, fingerprinted copy. Two of three examiners must release it at the start time, and a leaked copy names its source.
            </p>
            <div className="pt-hero__ctas">
              <Button variant="primary" size="lg" onClick={start} busy={busy} busyLabel={`${stage.label} ${s} s`} iconRight={<IconArrowRight size={20} stroke={2} aria-hidden />}>
                Start the 3-minute demo
              </Button>
              <Link className="pt-btn pt-btn--lg" to="/audit">
                View an audit trail
              </Link>
            </div>
            <p className="pt-hero__fine" aria-live="polite">
              {busy
                ? `Step ${stage.step} of ${START_STEPS}: six real testnet transactions (the exam, two centres, three groups). Usually 25–40 s; keep this tab open.`
                : 'No wallet, keys or funds needed. Demo keys are held by the server, testnet only.'}
            </p>
            {error && (
              <div className="pt-hero__error">
                <StartError code={error.code} message={error.message} onRetry={start} />
              </div>
            )}
          </div>
        </header>

        <section id="how" className="pt-landsec">
          <div className="pt-wrap pt-col" style={{ gap: 40 }}>
            <div className="pt-landsec__head">
              <h2 className="pt-landsec__title">Four guarantees, all on-chain</h2>
              <p className="pt-landsec__aside">Every action is signed with ML-DSA-87 and checked on QoreChain by the pqcVerify precompile. The server stores only ciphertext and hashes.</p>
            </div>
            <div className="pt-tiles">
              <Tile art={canary} artStyle={{ right: -24, top: 24, transform: 'rotate(10deg)' }} eyebrow="Canary copies" title="A leak names its source">
                Each centre's copy has its own question order, option order and phrasing. Paste a leaked excerpt and the detector says which copy it came from.
              </Tile>
              <Tile art={keyRing} artStyle={{ right: -34, top: 6, width: 250, transform: 'rotate(-10deg)' }} eyebrow="2-of-3 release" title="Two keys to open">
                The paper's key is split between three examiners. Two must release it, and the contract refuses anything before the start time.
              </Tile>
              <Tile art={padlock} artStyle={{ right: -20, top: 20, transform: 'rotate(8deg)' }} eyebrow="Revocable groups" title="Remove someone, lock them out">
                Released papers are sealed to the centre's current invigilators. Remove one and they can't open anything sent after.
              </Tile>
              <Tile art={stamp} artStyle={{ right: -16, top: 20, transform: 'rotate(-6deg)' }} eyebrow="Signed on-chain" title="Every action has a receipt">
                Releases, revocations and scripts are ML-DSA-87 signed and verified on-chain. Answer scripts are sealed to markers under pseudonyms.
              </Tile>
            </div>
          </div>
        </section>

        <section className="pt-landsec pt-landsec--tight">
          <div className="pt-wrap pt-col" style={{ gap: 32 }}>
            <div className="pt-landsec__notehead">
              <h2 className="pt-landsec__title pt-landsec__title--sm">How the demo runs</h2>
              <StickyNote>No wallet needed. Just press start.</StickyNote>
            </div>
            <ol className="pt-steps4">
              <li>
                <span>01 · Set</span>
                <strong>Two centres get their own encrypted copies</strong>
              </li>
              <li>
                <span>02 · Release</span>
                <strong>An early release is refused; at start time you release as Examiner 2</strong>
              </li>
              <li>
                <span>03 · Open and revoke</span>
                <strong>An invigilator opens an authentic copy; a removed one is locked out</strong>
              </li>
              <li>
                <span>04 · Trace</span>
                <strong>A leaked excerpt is traced to Centre B</strong>
              </li>
            </ol>
          </div>
        </section>

        <section className="pt-landsec pt-landsec--tight">
          <div className="pt-wrap pt-toolgrid">
            <AuditCard />
            <div className="pt-card pt-toolcard">
              <h3 className="pt-h3">Verify a paper</h3>
              <p className="pt-toolcard__text">Hash a paper in your browser and compare it with the commitment on-chain.</p>
              <Link className="pt-btn" to="/verify" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
                Verify a paper
              </Link>
            </div>
            <div className="pt-card pt-toolcard">
              <h3 className="pt-h3">Check my mark</h3>
              <p className="pt-toolcard__text">Prove your score against the Merkle root the board published on-chain.</p>
              <Link className="pt-btn" to="/marks" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
                Check my mark
              </Link>
            </div>
          </div>
        </section>

        <section className="pt-landsec pt-landsec--tight">
          <div className="pt-wrap">
            <div className="pt-claims">
              <div className="pt-col" style={{ gap: 10 }}>
                <h2 className="pt-claims__title">What we claim, and what we don't</h2>
                <p className="pt-toolcard__text">The server can't read papers and can't forge actions. Every action is signed and checked on-chain.</p>
              </div>
              <ul>
                <li>The exam board runs the centre groups, so it can read what's sealed to them. It never gets two shares unless two examiners release.</li>
                <li>A leaked copy names its centre or the committee, since examiners and the board hold every copy.</li>
                <li>A removed invigilator can still read what was sent before the removal.</li>
                <li>Metadata (who, when, sizes) is public on-chain. QoreSeal is 0.1.0, pending external review. Testnet only.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Tile({ art, artStyle, eyebrow, title, children }: { art: string; artStyle: React.CSSProperties; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <article className="pt-tile">
      <img className="pt-tile__art" src={art} alt="" aria-hidden="true" style={artStyle} />
      <span className="pt-eyebrow">{eyebrow}</span>
      <div className="pt-col" style={{ gap: 12 }}>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}
