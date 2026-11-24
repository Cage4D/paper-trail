import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { IconArrowRight, IconFlask } from '@tabler/icons-react';
import envelope from '../assets/stickers/sealed-envelope.svg';
import key from '../assets/stickers/key.svg';
import keyRing from '../assets/stickers/key-ring.svg';
import canary from '../assets/stickers/canary.svg';
import padlock from '../assets/stickers/padlock.svg';
import stamp from '../assets/stickers/authentic-stamp.svg';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { AppBar, Footer } from '../components/Shell';
import { StartError } from '../components/StartError';
import { StickyNote } from '../components/StickyNote';
import { Glossary } from '../components/Term';
import { useElapsed } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
import { startStage, useStartDemo } from '../lib/useStartDemo';

const EXAM_ID = /^0x[0-9a-fA-F]{64}$/;

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
      <p className="pt-toolcard__text">Every step for one exam, as recorded on the public blockchain.</p>
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
      <AppBar />
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
              Exam papers leak. Paper Trail locks each exam centre's copy until the start time, needs two of three examiners to unlock it, and makes every copy slightly different, so a leaked copy gives away where it came from.
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
                ? 'Preparing your demo exam: usually a few seconds. The blockchain setup carries on, live, on the next page.'
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
              <p className="pt-landsec__aside">Every step is signed with a quantum-safe digital signature and checked by the QoreChain blockchain itself, where it stays on public record. Our server only ever holds locked copies: it can't read a paper or fake a step.</p>
            </div>
            <div className="pt-tiles">
              <Tile art={canary} artStyle={{ right: -24, top: 24, transform: 'rotate(10deg)' }} eyebrow="Canary copies" title="A leak names its source">
                Every centre's copy has its own question order, answer order and wording. Paste in a leaked excerpt and Paper Trail tells you which centre's copy it came from.
              </Tile>
              <Tile art={keyRing} artStyle={{ right: -34, top: 6, width: 250, transform: 'rotate(-10deg)' }} eyebrow="2-of-3 release" title="Two keys to open">
                The key to the paper is split between three examiners. Any two can unlock it together, and the blockchain refuses everyone, even them, before the start time.
              </Tile>
              <Tile art={padlock} artStyle={{ right: -20, top: 20, transform: 'rotate(8deg)' }} eyebrow="Revocable groups" title="Remove someone, lock them out">
                An unlocked paper opens only for that centre's current staff. Remove someone from the team and they can't open anything sent afterwards.
              </Tile>
              <Tile art={stamp} artStyle={{ right: -16, top: 20, transform: 'rotate(-6deg)' }} eyebrow="Signed on-chain" title="Every action has a receipt">
                Every unlock, removal and answer script is signed and recorded on the public blockchain. Markers see a code name, never the candidate's name, and candidates can check their own mark.
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
                <strong>Opening it early is refused; at the start time you unlock it as Examiner 2</strong>
              </li>
              <li>
                <span>03 · Open and revoke</span>
                <strong>A centre opens a genuine copy; a removed staff member is locked out</strong>
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
              <h3 className="pt-h3">Try the encryption</h3>
              <p className="pt-toolcard__text">Make a key and lock a message in your own browser, with the code that locks the exam papers.</p>
              <Link className="pt-btn" to="/try" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
                Try encryption
              </Link>
            </div>
            <div className="pt-card pt-toolcard">
              <h3 className="pt-h3">Verify a paper</h3>
              <p className="pt-toolcard__text">Check a paper is exactly the one that was set, without sending it anywhere.</p>
              <Link className="pt-btn" to="/verify" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
                Verify a paper
              </Link>
            </div>
            <div className="pt-card pt-toolcard">
              <h3 className="pt-h3">Check my mark</h3>
              <p className="pt-toolcard__text">Use the code name on your ticket to prove your mark is the one the board published.</p>
              <Link className="pt-btn" to="/marks" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
                Check my mark
              </Link>
            </div>
          </div>
        </section>

        <section id="words" className="pt-landsec pt-landsec--tight">
          <div className="pt-wrap pt-col" style={{ gap: 24 }}>
            <h2 className="pt-landsec__title pt-landsec__title--sm">Words explained</h2>
            <p className="pt-landsec__aside" style={{ maxWidth: '62ch' }}>New to exams or blockchains? These are the words you'll see in the demo. Words with a dotted underline explain themselves when you tap them.</p>
            <Glossary />
          </div>
        </section>

        <section className="pt-landsec pt-landsec--tight">
          <div className="pt-wrap">
            <div className="pt-claims">
              <div className="pt-col" style={{ gap: 10 }}>
                <h2 className="pt-claims__title">What we claim, and what we don't</h2>
                <p className="pt-toolcard__text">Our server can't read papers and can't fake anyone's actions. Every step is signed and checked on the blockchain. Here's what it doesn't protect against.</p>
              </div>
              <ul>
                <li>The exam board manages the centres' teams, so it can read what's sent to them. It can never unlock a paper on its own: that still takes two examiners.</li>
                <li>A leaked copy points to its centre, or to the board and examiners, who hold every copy. It can't tell those apart.</li>
                <li>Someone removed from a team can still read what was sent to them before they were removed.</li>
                <li>Who did what, and when, is public on the blockchain; only the papers and answers are secret. The encryption library (QoreSeal 0.1.0) hasn't had an outside review yet. This runs on a practice blockchain (testnet) only.</li>
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
