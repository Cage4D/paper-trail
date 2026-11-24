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

function QuickLab() {
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
    <div className="pt-col" style={{ gap: 20 }}>
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

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Seal to any QoreChain address, and open with your own registered key.

/** Marker 1 of the demo: a registered QoreChain address with a published card (one-click example). */
export const EXAMPLE_ADDRESS = 'qor1u39s6c9ujvy9kpuz22p0mzck4q9k7f5y6nv85d';
const FAUCET = 'https://dashboard.qorechain.io/faucet';
const KEY_STORE = 'pt-my-key';
/** Two registration transactions at the default 0.1 QOR fee, with a little room. */
const REGISTER_MIN_QOR = 0.21;

type SealResult = { results: { address: string; ok: boolean; mode?: string; error?: string }[]; fileText?: string; mode?: string; bytes?: number };
type MyStatus = { address: string; pqc: string; kem: string; balance: string };
type OpenResult = { opened: boolean; text?: string; code?: string; to: string[]; mode: string; mine: boolean };

function loadBlob(): EncryptedBlob | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_STORE) ?? 'null');
    return v && typeof v.address === 'string' && typeof v.ciphertext === 'string' ? v : null;
  } catch {
    return null;
  }
}
type EncryptedBlob = { v: 1; kdf: 'argon2id'; params: unknown; salt: string; nonce: string; ciphertext: string; address: string };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const statusWord = (s: string) => (s === 'registered' ? 'registered on QoreChain' : s === 'not-registered' ? 'not registered yet' : 'a different key is registered for this address');

export function TryEncryption() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: string; text: string } | null>(null);
  const s = useElapsed(!!busy);
  const [params] = useState(() => new URLSearchParams(window.location.search));

  // ── 1. seal to addresses
  const [toText, setToText] = useState(() => params.get('to') ?? EXAMPLE_ADDRESS);
  const [message, setMessage] = useState('The paper opens at 09:00 tomorrow. Bring a calculator.');
  const [sealRes, setSealRes] = useState<SealResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [cards, setCards] = useState<Record<string, unknown> | null>(null);

  // ── 2. my key
  const [blob, setBlob] = useState<EncryptedBlob | null>(() => loadBlob());
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [status, setStatus] = useState<MyStatus | null>(null);
  const [regTx, setRegTx] = useState<{ pqcTx: string | null; kemTx: string | null } | null>(null);

  // ── 3. open
  const [fileText, setFileText] = useState('');
  const [openRes, setOpenRes] = useState<OpenResult | null>(null);

  useEffect(() => () => stopWorker(), []); // wipe keys when leaving the page
  useEffect(() => {
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);
  useEffect(() => {
    // recipient cards are public; with one, the browser seals hybrid after checking it against the chain
    api<{ roleAddress: string; sealCard: unknown }[]>('/directory', { timeoutMs: 30_000 })
      .then((rows) => setCards(Object.fromEntries(rows.filter((r) => r.sealCard).map((r) => [r.roleAddress, r.sealCard]))))
      .catch(() => setCards({}));
  }, []);

  const run = async (what: string, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError({ where: what, text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  const label = (what: string, text: string) => (busy === what ? `${text} ${s} s` : undefined);
  const err = (where: string) => error?.where === where && <Banner tone="error">{error.text}</Banner>;

  const addresses = toText.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean);
  const sealIt = () =>
    run('seal', async () => {
      if (!addresses.length) throw new Error('Add at least one qor1 address.');
      if (!message) throw new Error('Write a message to lock.');
      setSealRes(await ask<SealResult>({ type: 'seal-to', text: message, addresses, cards: cards ?? {} }));
      setCopied(false);
    });

  const createKey = () =>
    run('create', async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      if (pass !== pass2) throw new Error("The two passphrases don't match.");
      const r = await ask<{ blob: EncryptedBlob; address: string }>({ type: 'my-create', passphrase: pass });
      try {
        localStorage.setItem(KEY_STORE, JSON.stringify(r.blob));
      } catch {
        /* storage blocked: the key works until the page closes */
      }
      setBlob(r.blob);
      setUnlocked(r.address);
      setPass('');
      setPass2('');
      setStatus(await ask<MyStatus>({ type: 'my-status' }));
    });
  const unlock = () =>
    run('unlock', async () => {
      if (!blob) return;
      const r = await ask<{ address: string }>({ type: 'my-unlock', blob, passphrase: pass });
      setUnlocked(r.address);
      setPass('');
      setStatus(await ask<MyStatus>({ type: 'my-status' }));
    });
  const refresh = () => run('status', async () => setStatus(await ask<MyStatus>({ type: 'my-status' })));
  const register = () =>
    run('register', async () => {
      const r = await ask<{ pqcTx: string | null; kemTx: string | null; status: MyStatus; balance: string }>({ type: 'my-register' });
      setRegTx({ pqcTx: r.pqcTx, kemTx: r.kemTx });
      setStatus({ ...r.status, balance: r.balance });
    });
  const forget = () => {
    if (!window.confirm('Forget this key? It is removed from this browser for good. Anything sealed to its address can no longer be opened here.')) return;
    void ask({ type: 'my-forget' });
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* nothing stored */
    }
    setBlob(null);
    setUnlocked(null);
    setStatus(null);
    setRegTx(null);
    setOpenRes(null);
  };
  const openIt = () =>
    run('open', async () => {
      if (!fileText.trim()) throw new Error('Paste a sealed message or choose a .ptseal file.');
      setOpenRes(await ask<OpenResult>({ type: 'my-open', fileText }));
    });

  const registered = status?.pqc === 'registered' && status?.kem === 'registered';
  const canRegister = !!status && !registered && Number(status.balance) >= REGISTER_MIN_QOR && status.pqc !== 'other-key' && status.kem !== 'other-key';

  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 28 }}>
        <div className="pt-pagehead">
          <div className="pt-col" style={{ gap: 12 }}>
            <h1 className="pt-h1 pt-h1--xl">Try the encryption</h1>
            <p className="pt-lead">
              Lock a message so that only the owners of chosen QoreChain addresses can read it, then open messages locked for you with a key that lives in your browser. All the locking and opening happens here, with the same code that locks Paper Trail's exam papers. Your message is never sent to our server.
            </p>
          </div>
          <img src={envelope} alt="" aria-hidden="true" className="pt-pagehead__art" />
        </div>

        <Banner tone="demo">
          DEMO — testnet only. Keys made on this page are for QoreChain's practice network. Their 24 secret words are never shown, sent or saved in plain form.
        </Banner>

        <div className="pt-story">
          <strong>Try it with a friend (or two browsers):</strong> in browser A, make a key below, register it, and share its qor1 address. In browser B, lock a message for that address and send A the file. Back in A, open it. Only A's key can.
        </div>

        {/* ── 1 ── */}
        <article className="pt-cardx pt-lab__step" id="seal">
          <h2 className="pt-h3 pt-h3--lg">1. Lock a message for any QoreChain address</h2>
          <p className="pt-muted">
            Your browser reads each address's registered quantum-safe keys straight from QoreChain: its ML-KEM-1024 locking key, and its ML-DSA-87 key to check a recipient card when one is published. Without a card, the message is locked with the ML-KEM-1024 key alone.
          </p>
          <Field label="Recipients: qor1 addresses, one per line" help={<>Filled in with Marker 1 from the demo, a registered address. <button type="button" className="pt-linkbtn" onClick={() => setToText(EXAMPLE_ADDRESS)}>Use the example</button>{unlocked && <> · <button type="button" className="pt-linkbtn" onClick={() => setToText((t) => (t.includes(unlocked) ? t : `${t.trim()}\n${unlocked}`.trim()))}>Add my address</button></>}</>} className="pt-field--flex">
            <textarea className="pt-input pt-input--mono" rows={3} value={toText} onChange={(e) => (setToText(e.target.value), setSealRes(null))} spellCheck={false} />
          </Field>
          <Field label="Message" className="pt-field--flex">
            <textarea className="pt-input" rows={3} value={message} onChange={(e) => (setMessage(e.target.value), setSealRes(null))} />
          </Field>
          <Button variant="primary" icon={<IconLock size={18} stroke={2} aria-hidden />} busy={busy === 'seal'} busyLabel={label('seal', 'Checking the addresses on QoreChain, then locking…')} onClick={sealIt} className="pt-selfstart">
            Check the addresses and lock
          </Button>
          {err('seal')}
          {sealRes && (
            <>
              <div className="pt-xrows">
                {sealRes.results.map((r) => (
                  <XRow key={r.address} yes={r.ok} aside={r.ok ? <span className="pt-code" title={r.mode}>{r.mode === 'hybrid' ? 'card checked' : 'ML-KEM only'}</span> : undefined}>
                    <span className="pt-mono pt-mono--inline" style={{ overflowWrap: 'anywhere' }}>{r.address}</span>
                    <span className="pt-source__sub" style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>
                      {r.ok
                        ? r.mode === 'hybrid'
                          ? 'ML-KEM-1024 key registered; its recipient card matches its ML-DSA-87 key on QoreChain'
                          : 'ML-KEM-1024 key registered on QoreChain; no recipient card published'
                        : r.error}
                    </span>
                  </XRow>
                ))}
              </div>
              {sealRes.fileText && (
                <>
                  <Verdict tone="ok" icon={<IconLock size={32} stroke={2.5} />} title={`Locked for ${sealRes.results.length} address${sealRes.results.length === 1 ? '' : 'es'}`} big={false}>
                    <p>
                      {sealRes.bytes?.toLocaleString('en-GB')} bytes, {sealRes.mode === 'hybrid' ? 'ML-KEM-1024 + X25519' : 'ML-KEM-1024'}. Only the owners of these addresses can open it. Send them the file.
                    </p>
                  </Verdict>
                  <div className="pt-row">
                    <Button variant="primary" onClick={() => download('message.ptseal', sealRes.fileText!)}>
                      Download message.ptseal
                    </Button>
                    <Button onClick={() => void navigator.clipboard?.writeText(sealRes.fileText!).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy as text'}</Button>
                    <Button variant="ghost" onClick={() => (setFileText(sealRes.fileText!), document.getElementById('open')?.scrollIntoView())}>
                      Try opening it below
                    </Button>
                  </div>
                  <pre className="pt-excerpt pt-cipher pt-filepreview" aria-label="The sealed message file">{sealRes.fileText}</pre>
                </>
              )}
            </>
          )}
        </article>

        {/* ── 2 ── */}
        <article className="pt-cardx pt-lab__step" id="key">
          <h2 className="pt-h3 pt-h3--lg">2. Your own registered key</h2>
          <p className="pt-muted">
            Make a key in this browser and register its public halves on QoreChain, so anyone can lock messages for your address. The key is kept in this browser, encrypted with your passphrase (Argon2id and AES-256-GCM). Forget the passphrase or clear this site's data and the key is gone: it's a practice key.
          </p>
          {!blob && !unlocked && (
            <div className="pt-row pt-row--fields">
              <Field label="Passphrase (8+ characters)" className="pt-field--grow">
                <input className="pt-input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
              </Field>
              <Field label="Type it again" className="pt-field--grow">
                <input className="pt-input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
              </Field>
            </div>
          )}
          {!blob && !unlocked && (
            <Button variant="primary" icon={<IconKey size={18} stroke={2} aria-hidden />} busy={busy === 'create'} busyLabel={label('create', 'Making and encrypting your key…')} onClick={createKey} className="pt-selfstart">
              Make my key
            </Button>
          )}
          {blob && !unlocked && (
            <>
              <p>
                This browser has a key for <HashLink value={blob.address} kind="plain" small />. Enter its passphrase to use it.
              </p>
              <div className="pt-row">
                <Field label="Passphrase" className="pt-field--grow">
                  <input className="pt-input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
                </Field>
              </div>
              <div className="pt-row">
                <Button variant="primary" icon={<IconLockOpen size={18} stroke={2} aria-hidden />} busy={busy === 'unlock'} busyLabel={label('unlock', 'Unlocking…')} onClick={unlock}>
                  Unlock my key
                </Button>
                <Button variant="ghost" onClick={forget}>
                  Forget this key
                </Button>
              </div>
            </>
          )}
          {err('create')}
          {err('unlock')}
          {unlocked && status && (
            <>
              <dl className="pt-kv">
                <dt>Your address</dt>
                <dd>
                  <HashLink value={status.address} kind="plain" small />
                </dd>
                <dt>Balance</dt>
                <dd>
                  {status.balance} testnet QOR{' '}
                  <a href={FAUCET} target="_blank" rel="noreferrer">
                    Get testnet QOR from the faucet
                  </a>
                </dd>
                <dt>Signing key (ML-DSA-87)</dt>
                <dd>{statusWord(status.pqc)}</dd>
                <dt>Locking key (ML-KEM-1024)</dt>
                <dd>{statusWord(status.kem)}</dd>
              </dl>
              {registered ? (
                <Verdict tone="ok" title="Registered: anyone can lock messages for your address" big={false}>
                  <p>Share your address. Messages locked for it can only be opened with the key in this browser.</p>
                </Verdict>
              ) : (
                <>
                  <p className="pt-muted pt-small">
                    Registering sends two transactions from your address, about 0.2 testnet QOR in fees. Get testnet QOR from the faucet for the address above, then check your balance again.
                  </p>
                  <div className="pt-row">
                    <Button variant="primary" busy={busy === 'register'} busyLabel={label('register', 'Registering on QoreChain…')} onClick={register} disabled={!canRegister}>
                      Register my keys on QoreChain
                    </Button>
                    <Button busy={busy === 'status'} busyLabel={label('status', 'Checking…')} onClick={refresh}>
                      Check balance again
                    </Button>
                  </div>
                </>
              )}
              {regTx && (
                <div className="pt-txlist">
                  {regTx.pqcTx && <HashLink value={regTx.pqcTx} label="ML-DSA-87 registration" small />}
                  {regTx.kemTx && <HashLink value={regTx.kemTx} label="ML-KEM-1024 registration" small />}
                </div>
              )}
              <Button variant="ghost" onClick={forget} className="pt-selfstart">
                Forget this key
              </Button>
            </>
          )}
          {err('status')}
          {err('register')}
        </article>

        {/* ── 3 ── */}
        <article className="pt-cardx pt-lab__step" id="open">
          <h2 className="pt-h3 pt-h3--lg">3. Open a message locked for you</h2>
          <p className="pt-muted">Paste a sealed message, or choose a .ptseal file. Your key opens it here, in this browser.</p>
          <textarea className="pt-input pt-input--mono" rows={5} value={fileText} onChange={(e) => (setFileText(e.target.value), setOpenRes(null))} placeholder='{ "format": "paper-trail-sealed-message", … }' aria-label="Sealed message" spellCheck={false} />
          <div className="pt-row">
            <label className="pt-btn pt-btn--sm">
              Choose a file
              <input type="file" accept=".ptseal,.json,.txt,application/json" hidden onChange={(e) => void e.target.files?.[0]?.text().then((t) => (setFileText(t), setOpenRes(null)))} />
            </label>
            <Button variant="primary" icon={<IconLockOpen size={18} stroke={2} aria-hidden />} busy={busy === 'open'} busyLabel={label('open', 'Opening…')} onClick={openIt} disabled={!unlocked}>
              Open it with my key
            </Button>
            {!unlocked && <span className="pt-muted pt-small">Make or unlock your key in step 2 first.</span>}
          </div>
          {err('open')}
          {openRes &&
            (openRes.opened ? (
              <Verdict tone="ok" title="Opened with your key" big={false}>
                <p style={{ overflowWrap: 'anywhere' }}>“{openRes.text}”</p>
                <p className="pt-small">Locked for {openRes.to.length} address{openRes.to.length === 1 ? '' : 'es'}, including yours.</p>
              </Verdict>
            ) : (
              <XRow yes={false} aside={<span className="pt-code" title={openRes.code}>Locked out</span>}>
                {openRes.mine
                  ? `Your address is listed, but this key can't open it (${openRes.code}). Was it made with a different key for the same address?`
                  : `This message wasn't locked for your address, so your key can't open it (${openRes.code}). It was locked for: ${openRes.to.join(', ')}.`}
              </XRow>
            ))}
        </article>

        <details className="pt-cardx pt-quicklab">
          <summary className="pt-h3">Quick test without registering anything</summary>
          <p className="pt-muted">A throwaway key in this browser locks a message for itself (and, if you like, a demo exam's markers), opens it, and shows that a stranger's key is refused. Nothing to set up.</p>
          <QuickLab />
        </details>

        <Note>
          In the live demo, the server plays every role with demo keys and runs this same code on their behalf, so you can click through without a wallet. Here, the keys are yours and stay in your browser. Registering goes through our server only to reach QoreChain (its public endpoints block browsers): your browser signs the transactions first, so the server can't change them. <Link to="/demo">Try the live demo</Link>.
        </Note>
        <OnChainDetails
          summary="Technical details: what runs where"
          rows={[
            ['Lock', '@paper-trail/core resolveAddressRecipient (QoreSeal resolveRecipient: ML-KEM-1024 key from the KEM registry; recipient card checked against the ML-DSA-87 key from pqcKeyStatus) and sealMessage (QoreSeal, purpose papertrail:message:v1; the recipient list is authenticated)'],
            ['Chain reads', 'From your browser to the QoreChain EVM JSON-RPC: qor_getKEMKey and qor_getPQCKeyStatus (CORS-enabled); recipient cards from the Paper Trail directory, verified before use'],
            ['Your key', '@paper-trail/core createRoleKey and encryptRoleKey (Argon2id + AES-256-GCM) in a Web Worker; only the encrypted blob is stored, in this browser'],
            ['Register', '@paper-trail/core ensureRoleOnChain: MsgRegisterPQCKey (ML-DSA-87) and MsgRegisterKEMKey (ML-KEM-1024), signed here, relayed unchanged by the API to QoreChain'],
            ['Open', '@paper-trail/core openMessage with your ML-KEM-1024 (+ X25519) secret key; any other key fails with NOT_A_RECIPIENT'],
          ]}
        />
      </section>
    </AppPage>
  );
}
