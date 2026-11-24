import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { IconKey, IconLock, IconLockOpen, IconUserQuestion } from '@tabler/icons-react';
import envelope from '../assets/stickers/sealed-envelope.svg';
import { Banner, Note } from '../components/Banner';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { HashLink } from '../components/HashLink';
import { AppPage } from '../components/Shell';
import { Term } from '../components/Term';
import { OnChainDetails, Verdict, XRow } from '../components/Verdict';
import { ApiError, api } from '../lib/api';
import { ask, stopWorker, WorkerError } from '../lib/cryptoWorker';
import { useElapsed } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
import type { KeyInfo, SealedInfo } from '../lib/sealLab';
import { EXAM_ID_RE } from './Audit';

/** A demo exam from a full live run (its markers are registered on QoreChain); used when this tab has none. */
const SAMPLE_EXAM = '0xfe79de8001e630167ac698bb961b0872dc941e772b4b66e6e3bef96e64811e98';

type Sealed = SealedInfo & { checks: { what: string; ok: boolean }[] };
type Stranger = { opened: boolean; code?: string; stranger: string };

const errText = (e: unknown) => (e instanceof WorkerError || e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

export function TryEncryption() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<KeyInfo | null>(null);
  const [text, setText] = useState('Paper opens at 09:00. Bring a calculator.');
  const [withMarkers, setWithMarkers] = useState(true);
  const [examId, setExamId] = useState(() => getRecentDemo()?.examId ?? SAMPLE_EXAM);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [opened, setOpened] = useState<{ text: string; ms: number } | null>(null);
  const [stranger, setStranger] = useState<Stranger | null>(null);
  const s = useElapsed(!!busy);

  useEffect(() => () => stopWorker(), []); // forget the keys when leaving the page

  const run = async (what: string, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const makeKey = () =>
    run('key', async () => {
      setKey(await ask<KeyInfo>({ type: 'make-key' }));
      setSealed(null);
      setOpened(null);
      setStranger(null);
    });

  const lock = () =>
    run('seal', async () => {
      let markers: unknown;
      const id = examId.trim().toLowerCase();
      if (withMarkers) {
        if (!EXAM_ID_RE.test(id)) throw new Error('Enter an exam id (0x followed by 64 hex characters), or untick the markers option.');
        markers = await api(`/exams/${id}/markers`, { timeoutMs: 60_000 });
      }
      const practiceExam = withMarkers ? id : `0x${'0'.repeat(63)}1`;
      const centre = `0x${'0'.repeat(63)}a`;
      setSealed(await ask<Sealed>({ type: 'seal', text, examId: practiceExam, centreId: centre, markers }));
      setOpened(null);
      setStranger(null);
    });

  const open = () => run('open', async () => setOpened(await ask({ type: 'open' })));
  const tryStranger = () => run('stranger', async () => setStranger(await ask<Stranger>({ type: 'open-with-stranger' })));

  const label = (what: string, text: string) => (busy === what ? `${text} ${s} s` : undefined);

  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 28 }}>
        <div className="pt-pagehead">
          <div className="pt-col" style={{ gap: 12 }}>
            <h1 className="pt-h1 pt-h1--xl">Try the encryption</h1>
            <p className="pt-lead">
              Everything on this page happens in your own browser, with the same code Paper Trail uses to lock exam papers and answer scripts. Make a key, lock a message so only chosen people can read it, then open it again. Nothing you type here is sent anywhere.
            </p>
          </div>
          <img src={envelope} alt="" aria-hidden="true" className="pt-pagehead__art" />
        </div>

        <Banner tone="demo">
          DEMO — testnet only. The key made here is a throwaway: it isn't registered on QoreChain, holds nothing, and is forgotten when you leave this page. Its 24 secret words are never shown or saved.
        </Banner>
        {error && <Banner tone="error">{error}</Banner>}

        <ol className="pt-lab">
          {/* 1. key */}
          <li className="pt-cardx pt-lab__step">
            <h2 className="pt-h3 pt-h3--lg">1. Make a key in this browser</h2>
            <p className="pt-muted">
              A Paper Trail key has a public half (anyone can lock things for you with it) and a secret half (only you can open them). The secret half stays inside a background worker on this page.
            </p>
            <Button variant={key ? 'secondary' : 'primary'} icon={<IconKey size={18} stroke={2} aria-hidden />} busy={busy === 'key'} busyLabel={label('key', 'Making a key…')} onClick={makeKey} className="pt-selfstart">
              {key ? 'Make a new key' : 'Make my key'}
            </Button>
            {key && (
              <dl className="pt-kv">
                <dt>Your address</dt>
                <dd>
                  <HashLink value={key.address} kind="plain" small />
                </dd>
                <dt>Public locking key</dt>
                <dd>
                  ML-KEM-1024, {key.kemPublicKeyBytes.toLocaleString('en-GB')} bytes · code <HashLink value={key.kemPublicKeyCode} kind="plain" small copy={false} />
                </dd>
                <dt>Made in</dt>
                <dd>{key.ms} ms, in this browser</dd>
              </dl>
            )}
          </li>

          {/* 2. lock */}
          <li className={`pt-cardx pt-lab__step${key ? '' : ' pt-lab__step--off'}`}>
            <h2 className="pt-h3 pt-h3--lg">2. Lock a message</h2>
            <Field label="Your message" className="pt-field--flex">
              <textarea className="pt-input" rows={3} value={text} onChange={(e) => (setText(e.target.value), setSealed(null), setOpened(null), setStranger(null))} disabled={!key} />
            </Field>
            <label className="pt-check">
              <input type="checkbox" checked={withMarkers} onChange={(e) => (setWithMarkers(e.target.checked), setSealed(null))} disabled={!key} />
              <span>
                Also lock it for the real markers of a demo exam. Your browser first checks their keys against QoreChain itself, not against our server's word.
              </span>
            </label>
            {withMarkers && (
              <Field label="Exam id" help={getRecentDemo() ? 'The demo you ran in this tab.' : 'A demo exam from a full live run.'} className="pt-field--flex">
                <input className="pt-input pt-input--mono" value={examId} onChange={(e) => (setExamId(e.target.value), setSealed(null))} spellCheck={false} disabled={!key} />
              </Field>
            )}
            <Button variant={key && !sealed ? 'primary' : 'secondary'} icon={<IconLock size={18} stroke={2} aria-hidden />} busy={busy === 'seal'} busyLabel={label('seal', withMarkers ? 'Checking the markers on QoreChain, then locking…' : 'Locking…')} onClick={lock} disabled={!key} className="pt-selfstart">
              Lock it
            </Button>
            {sealed && (
              <>
                {sealed.checks.length > 0 && (
                  <div className="pt-xrows">
                    {sealed.checks.map((c) => (
                      <XRow key={c.what} yes={c.ok}>
                        {c.what}
                      </XRow>
                    ))}
                  </div>
                )}
                <Verdict tone="ok" icon={<IconLock size={32} stroke={2.5} />} title={`Locked for ${sealed.recipients === 1 ? 'you only' : `${sealed.recipients} people: you${sealed.recipients > 1 ? ` and ${sealed.recipients - 1} marker${sealed.recipients > 2 ? 's' : ''}` : ''}`}`} big={false}>
                  <p>
                    {sealed.bytes.toLocaleString('en-GB')} bytes, locked in {sealed.ms} ms. This is all anyone else would see:
                  </p>
                </Verdict>
                <pre className="pt-excerpt pt-cipher" aria-label="The start of the locked message, as unreadable bytes">{sealed.preview}…</pre>
                <span className="pt-small pt-muted">
                  Its <Term k="hash">code</Term>: <span className="pt-mono">{sealed.code.slice(0, 18)}…</span>
                </span>
              </>
            )}
          </li>

          {/* 3. open */}
          <li className={`pt-cardx pt-lab__step${sealed ? '' : ' pt-lab__step--off'}`}>
            <h2 className="pt-h3 pt-h3--lg">3. Open it with your key</h2>
            <Button variant={sealed && !opened ? 'primary' : 'secondary'} icon={<IconLockOpen size={18} stroke={2} aria-hidden />} busy={busy === 'open'} busyLabel={label('open', 'Opening…')} onClick={open} disabled={!sealed} className="pt-selfstart">
              Open it
            </Button>
            {opened && (
              <Verdict tone={opened.text === text ? 'ok' : 'bad'} title={opened.text === text ? 'Opened: it matches what you typed' : "Opened, but it doesn't match"} big={false}>
                <p className="pt-mono" style={{ overflowWrap: 'anywhere' }}>“{opened.text}”</p>
                <p className="pt-small">Opened in {opened.ms} ms, in this browser.</p>
              </Verdict>
            )}
          </li>

          {/* 4. stranger */}
          <li className={`pt-cardx pt-lab__step${sealed ? '' : ' pt-lab__step--off'}`}>
            <h2 className="pt-h3 pt-h3--lg">4. Try someone else's key</h2>
            <p className="pt-muted">Make a second, unrelated key and try to open the same message with it. It should be refused.</p>
            <Button icon={<IconUserQuestion size={18} stroke={2} aria-hidden />} busy={busy === 'stranger'} busyLabel={label('stranger', 'Trying a stranger’s key…')} onClick={tryStranger} disabled={!sealed} className="pt-selfstart">
              Try a stranger's key
            </Button>
            {stranger && (
              <XRow yes={!stranger.opened} aside={<span className="pt-code" title={stranger.code}>{stranger.opened ? 'opened' : 'Locked out'}</span>}>
                {stranger.opened ? 'A stranger could open it. That should never happen; please report it.' : `Refused, as it should be: that key isn't one of the message's recipients (${stranger.code}).`}
              </XRow>
            )}
          </li>
        </ol>

        <Note>
          This is the browser side of Paper Trail. In the live demo, the server plays every role with demo keys and runs this same code on their behalf, so you can click through without a wallet. A real examiner, invigilator or marker would run it here, in their own browser, with a key only they hold.{' '}
          <Link to="/demo">Try the live demo</Link>.
        </Note>
        <OnChainDetails
          summary="Technical details: what ran in your browser"
          rows={[
            ['Key', '@paper-trail/core createRoleKey: a fresh BIP-39 mnemonic deriving ML-DSA-87 (QoreSign) and ML-KEM-1024 + X25519 (QoreSeal) keys, in a Web Worker'],
            ['Lock', '@paper-trail/core sealScript: QoreSeal multi-recipient envelope, purpose papertrail:script:v1, chain id qorechain-diana'],
            ['Markers', '@paper-trail/core resolveGroupRecipients: EpochChanged log and membersHash read from the EVM RPC, current epoch from PaperTrail.centreEpoch, each recipient card verified against the pqcKeyStatus precompile and the ML-KEM-1024 key registry (qor_getKEMKey)'],
            ['Open', '@paper-trail/core openScript with your ML-KEM-1024 + X25519 secret key; a stranger key fails with NOT_A_RECIPIENT'],
            ['Sent', 'Only public reads: the marker team from the Paper Trail API, and chain data from the QoreChain RPC. Your message and keys never leave this page.'],
          ]}
        />
      </section>
    </AppPage>
  );
}
