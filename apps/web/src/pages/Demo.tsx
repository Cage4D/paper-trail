import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { IconArrowRight, IconCheck, IconKey, IconLock, IconX } from '@tabler/icons-react';
import stamp from '../assets/stickers/authentic-stamp.svg';
import canary from '../assets/stickers/canary.svg';
import envelope from '../assets/stickers/sealed-envelope.svg';
import { Banner, Note } from '../components/Banner';
import { Beat, BeatSkeleton } from '../components/Beat';
import { Button } from '../components/Button';
import { CanaryDiff } from '../components/CanaryDiff';
import { Chip } from '../components/Chip';
import { Countdown, useSecondsUntil } from '../components/Countdown';
import { HashLink, TxGroup } from '../components/HashLink';
import { PaperView } from '../components/PaperView';
import { QorexConnect } from '../components/QorexConnect';
import { ReleaseMeter } from '../components/ReleaseMeter';
import { RoleTag } from '../components/RoleTag';
import { Term } from '../components/Term';
import { AppPage } from '../components/Shell';
import { ConfidenceBar, OnChainDetails, Verdict, XRow } from '../components/Verdict';
import { ApiError, api } from '../lib/api';
import { CONTRACT } from '../lib/config';
import { readDemoCache, writeDemoCache, type DemoCache } from '../lib/demoCache';
import { DEMO_PAPER_TITLE, derive, parseLeakSummary, PLAYABLE, ROLE_NAME, roleLabel, type Derived } from '../lib/demoState';
import { humaniseIsoTimes, mmss, shortHash, utcClock } from '../lib/format';
import { useElapsed, usePoll } from '../lib/hooks';
import { parseCopy } from '../lib/paper';
import { setRecentDemo, VERIFY_DRAFT_KEY } from '../lib/recent';
import type { DemoRole, DemoState, EventsPage, LeakResult, OpenResult, ReleaseResult, RemoveResult, ScriptsResult } from '../lib/types';

const PqcBadge = lazy(() => import('../components/PqcBadge'));

type ActKey = 'early' | 'bot' | 'judge' | 'openA1' | 'remove' | 'scripts' | 'openA2' | 'leak';

const BEATS = ['Set the exam', 'Try to open early', 'Two keys open it', 'Open at the centre', 'Remove someone', 'Trace a leak', 'Public record'];
const DEMO_TITLE_PREFIX = /^Paper Trail Demo Board\s+—\s+/;

const toApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));

/** Busy label with elapsed seconds: "Sending to QoreChain… 6 s". */
function useBusyLabel(active: boolean, text: string) {
  const s = useElapsed(active);
  return `${text} ${s} s`;
}

function ActionError({ error, onRetry }: { error?: ApiError; onRetry?: () => void }) {
  if (!error) return null;
  if (error.code === 'NOT_RELEASED') return <Banner tone="wait">{error.message}</Banner>;
  return (
    <Banner tone="error" action={error.retryable && onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : undefined}>
      {error.message}
    </Banner>
  );
}

function PendingTx({ tx }: { tx?: string }) {
  if (!tx) return null;
  return (
    <Banner tone="info" action={<HashLink value={tx} kind="tx" label="pending" small />}>
      Saved — sending to QoreChain… The network is busy; don't resend.
    </Banner>
  );
}

export function Demo() {
  const { demoId = '', role: roleParam } = useParams();
  const [state, setState] = useState<DemoState | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [cache, setCache] = useState<DemoCache>(() => readDemoCache(demoId));
  const [offsetMs, setOffsetMs] = useState(0);
  const [you, setYou] = useState<DemoRole>(() => (PLAYABLE.includes(roleParam as DemoRole) ? (roleParam as DemoRole) : 'examiner2'));
  const offsetSet = useRef(false);

  useEffect(() => setCache(readDemoCache(demoId)), [demoId]);

  const refresh = useCallback(async () => {
    try {
      const s = await api<DemoState>(`/demo/${demoId}`, { timeoutMs: 60_000 });
      setState(s);
      setLoadError(null);
      setRecentDemo({ demoId: s.demoId, examId: s.examId });
      if (!offsetSet.current && s.startsInSeconds > 1) {
        // server clock ≈ startTime - startsInSeconds; correct the countdown for this tab's clock skew
        offsetSet.current = true;
        setOffsetMs(new Date(s.startTime).getTime() - s.startsInSeconds * 1000 - Date.now());
      }
    } catch (e) {
      setLoadError(toApiError(e));
    }
  }, [demoId]);
  usePoll(refresh, 4500);

  const secondsLeft = useSecondsUntil(state?.startTime, offsetMs);
  const live = secondsLeft !== null && secondsLeft <= 0;
  const d = useMemo(() => (state ? derive(state, cache, live) : null), [state, cache, live]);

  // ── actions: one in flight per key, never re-sent automatically (except the bot at zero) ──
  const [inflight, setInflight] = useState<Partial<Record<ActKey, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<ActKey, ApiError>>>({});
  const [pendingTx, setPendingTx] = useState<Partial<Record<ActKey, string>>>({});
  const running = useRef(new Set<ActKey>());
  const patch = (p: Partial<DemoCache>) => setCache(writeDemoCache(demoId, p));

  const run = useCallback(
    async <T,>(key: ActKey, call: () => Promise<T>, onOk: (r: T) => void) => {
      if (running.current.has(key)) return;
      running.current.add(key);
      setInflight((x) => ({ ...x, [key]: true }));
      setErrors((x) => ({ ...x, [key]: undefined }));
      try {
        onOk(await call());
      } catch (e) {
        const err = toApiError(e);
        if (err.code === 'RELAYER_BUSY' && err.params.txHash) setPendingTx((x) => ({ ...x, [key]: String(err.params.txHash) }));
        else setErrors((x) => ({ ...x, [key]: err }));
      } finally {
        running.current.delete(key);
        setInflight((x) => ({ ...x, [key]: false }));
        void refresh();
      }
    },
    [refresh],
  );

  const act = <T,>(as: string, action: string, params?: Record<string, string>) =>
    api<T>(`/demo/${demoId}/act`, { method: 'POST', body: { as, action, ...(params ? { params } : {}) } });

  const judgeRole: DemoRole = you === 'examiner3' ? 'examiner3' : 'examiner2';

  const releaseEarly = () =>
    run('early', () => act<ReleaseResult>('examiner1', 'release', { centre: 'A' }), (r) => patch({ early: [...(readDemoCache(demoId).early ?? []), r] }));
  const releaseJudge = () =>
    run('judge', () => act<ReleaseResult>(judgeRole, 'release', { centre: 'A' }), (r) => {
      if (r.ok) patch({ releases: { ...readDemoCache(demoId).releases, [judgeRole]: r } });
      else setErrors((x) => ({ ...x, judge: new ApiError('TOO_EARLY', humaniseIsoTimes(r.error.message)) }));
    });
  const openA1 = () => run('openA1', () => act<OpenResult>('invigilatorA1', 'open'), (r) => patch({ openA1: r }));
  const removeA2 = () => run('remove', () => act<RemoveResult>('board', 'remove-invigilator', { target: 'invigilatorA2' }), (r) => patch({ remove: r }));
  const submitScripts = () => run('scripts', () => act<ScriptsResult>('candidates', 'submit-scripts'), (r) => patch({ scripts: r }));
  const openA2 = () => run('openA2', () => act<OpenResult>('invigilatorA2', 'open'), (r) => patch({ openA2: r }));
  const leak = () =>
    run('leak', () => api<LeakResult>(`/demo/${demoId}/leak`, { method: 'POST', body: { centre: 'B' } }), (r) => patch({ leaks: [...(readDemoCache(demoId).leaks ?? []), r] }));

  // ── the examiner-1 bot release at zero, retrying every 3 s while the chain clock catches up ──
  const [botWaiting, setBotWaiting] = useState(false);
  const [botGaveUp, setBotGaveUp] = useState(false);
  const botNeeded = !!d && live && !d.bot && !d.releasedA && !!d.set;
  useEffect(() => {
    if (!botNeeded || botGaveUp || running.current.has('bot') || pendingTx.bot) return;
    let cancelled = false;
    void run(
      'bot',
      async () => {
        const deadline = Date.now() + 24_000;
        for (;;) {
          try {
            const r = await act<ReleaseResult>('examiner1', 'release', { centre: 'A' });
            if (r.ok || Date.now() > deadline || cancelled) {
              setBotWaiting(false);
              if (!r.ok) throw new ApiError('TOO_EARLY', `${humaniseIsoTimes(r.error.message)} The chain clock is still behind; try again in a moment.`);
              return r;
            }
          } catch (e) {
            if (e instanceof ApiError && e.code === 'ALREADY_RELEASED') return null; // another tab got there first
            throw e;
          }
          setBotWaiting(true);
          await new Promise((res) => setTimeout(res, 3000));
        }
      },
      (r) => {
        if (r) patch({ releases: { ...readDemoCache(demoId).releases, examiner1: r } });
      },
    ).then(() => setBotWaiting(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botNeeded, botGaveUp]);
  useEffect(() => {
    if (errors.bot) setBotGaveUp(true);
  }, [errors.bot]);

  // clear "pending tx" banners once the step shows up in the server's log
  useEffect(() => {
    if (!d) return;
    const done: Partial<Record<ActKey, boolean>> = { bot: !!d.bot, judge: !!d.judge, openA1: !!d.openA1, remove: !!d.remove, scripts: !!d.scripts, openA2: !!d.openA2 };
    setPendingTx((p) => {
      const next = { ...p };
      let changed = false;
      for (const k of Object.keys(p) as ActKey[]) if (done[k]) (delete next[k], (changed = true));
      return changed ? next : p;
    });
  }, [d]);

  // ── announcements (once per beat change) ──
  const [announce, setAnnounce] = useState('');
  const prevStates = useRef<Derived['states'] | null>(null);
  useEffect(() => {
    if (!d) return;
    const prev = prevStates.current;
    prevStates.current = d.states;
    if (!prev) return;
    for (const n of [1, 2, 3, 4, 5, 6, 7] as const) {
      if (prev[n] !== d.states[n] && (d.states[n] === 'done' || d.states[n] === 'refused'))
        setAnnounce(`Beat ${n} ${d.states[n] === 'refused' ? 'refused by the contract' : 'done'}: ${BEATS[n - 1]}.`);
      else if (prev[n] !== d.states[n] && d.states[n] === 'running') setAnnounce(`Beat ${n} is next: ${BEATS[n - 1]}.`);
    }
  }, [d]);

  // ── audit event count for beat 7 ──
  const [eventCount, setEventCount] = useState<number | null>(null);
  usePoll(
    async () => {
      if (!state) return;
      try {
        const r = await api<EventsPage>(`/exams/${state.examId}/events`, { timeoutMs: 60_000 });
        setEventCount(r.events.length);
      } catch {
        /* the count is decoration; the link still works */
      }
    },
    20_000,
    !!state && d?.states[7] === 'running',
  );

  // ── local expand/collapse ──
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const isCollapsed = (n: 1 | 2) => {
    if (!d) return false;
    if (expanded[n] !== undefined) return !expanded[n];
    return n === 1 ? live && d.current > 2 : d.current > 2;
  };
  const toggle = (n: number) => setExpanded((x) => ({ ...x, [n]: x[n] === undefined ? isCollapsed(n as 1 | 2) : !x[n] }));

  // ── render ──
  if (loadError && !state)
    return (
      <AppPage demoId={demoId}>
        <section className="pt-wrap pt-section pt-empty">
          <img src={envelope} alt="" aria-hidden="true" className="pt-empty__art" />
          <h1 className="pt-h1">{loadError.code === 'NOT_FOUND' ? 'No demo with this id' : "Can't open this demo"}</h1>
          <Banner tone="error" action={loadError.retryable ? <Button size="sm" onClick={() => void refresh()}>Try again</Button> : undefined}>
            {loadError.message}
          </Banner>
          <Link className="pt-btn pt-btn--primary" to="/">
            Start a new demo
          </Link>
        </section>
      </AppPage>
    );

  const title = (() => {
    // the demo exam's on-chain title is a label; the paper's own title is the one to show
    const t = cache.start ? parseCopy(cache.start.variants.master).title : DEMO_PAPER_TITLE;
    return t ? t.replace(DEMO_TITLE_PREFIX, '') : (state?.exam.title ?? 'Judge mode');
  })();

  return (
    <AppPage demoId={demoId}>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {!state || !d ? (
        <DemoSkeleton />
      ) : (
        <>
          <section className="pt-wrap pt-demohead">
            <div className="pt-demohead__main">
              <span className="pt-eyebrow">{d.doneCount >= 6 ? 'Live demo · 6 of 7 steps done' : `Live demo · step ${d.current} of 7`}</span>
              <h1 className="pt-h1">{title}</h1>
              <div className="pt-row">
                <HashLink value={state.examId} to={`/exams/${state.examId}`} label="exam" small />
                {d.releasedA ? <Chip status="released">Centre A unlocked</Chip> : <Chip status="sealed">Locked</Chip>}
                <Chip status="epoch" icon={d.remove ? undefined : null}>
                  {d.remove ? `Centre A team · v${d.epochA}` : '2 exam centres'}
                </Chip>
              </div>
              <div className="pt-row pt-rolepick">
                <label htmlFor="pt-role">You are</label>
                <select id="pt-role" className="pt-input pt-rolepick__select" value={you} onChange={(e) => setYou(e.target.value as DemoRole)}>
                  {PLAYABLE.map((r) => (
                    <option key={r} value={r}>
                      {r === 'examiner2' ? 'Examiner 2 (you)' : ROLE_NAME[r]}
                    </option>
                  ))}
                </select>
                <span className="pt-muted pt-small">Pick who you play. Bots play everyone else.</span>
              </div>
              <div className="pt-row">
                {cache.start?.roles[you] && (
                  <Suspense fallback={null}>
                    <PqcBadge key={you} address={cache.start.roles[you].roleAddress} who={ROLE_NAME[you]} />
                  </Suspense>
                )}
                <QorexConnect />
              </div>
            </div>
            <div className="pt-demohead__side">
              <Countdown startTime={state.startTime} offsetMs={offsetMs} />
              <ReleaseMeter count={d.releaseCountA} released={d.releasedA} epoch={d.remove ? Math.max(1, d.epochA - 1) : d.epochA} centre="Centre A" />
            </div>
          </section>

          {!live && (
            <div className="pt-wrap" style={{ paddingBottom: 24 }}>
              <Banner tone="info">
                <strong>The story:</strong> an exam board has sent a locked exam paper to two exam centres. Nobody can open it before the start time, and even then it takes two of the three examiners' keys. You are Examiner 2. While you wait, compare the two centres' copies below: they're deliberately different. At 00:00, Examiner 1 (played by a bot) uses their key, then it's your turn.
              </Banner>
            </div>
          )}
          {loadError && (
            <div className="pt-wrap" style={{ paddingBottom: 24 }}>
              <Banner tone="wait">Lost contact with the API ({loadError.message}) Still trying every few seconds.</Banner>
            </div>
          )}

          <div className="pt-wrap pt-demobody">
            <nav aria-label="Beats" className="pt-beatindex pt-desktop">
              <span className="pt-eyebrow">7 steps</span>
              {BEATS.map((b, i) => {
                const st = d.states[(i + 1) as 1];
                return (
                  <a key={b} href={`#b${i + 1}`} className={`pt-beatindex__item pt-beatindex__item--${st}${d.current === i + 1 ? ' pt-beatindex__item--current' : ''}`}>
                    <span className="pt-beatindex__mark" aria-hidden>
                      {st === 'done' ? <IconCheck size={14} stroke={2.5} /> : st === 'refused' ? <IconX size={14} stroke={2.5} /> : i + 1}
                    </span>
                    {b}
                    <span className="sr-only"> ({st})</span>
                  </a>
                );
              })}
            </nav>
            <ol className="pt-stepper">
              <BeatSet d={d} state={state} cache={cache} live={live} collapsed={isCollapsed(1)} onToggle={() => toggle(1)} />
              <BeatEarly d={d} cache={cache} live={live} collapsed={isCollapsed(2)} onToggle={() => toggle(2)} busy={!!inflight.early} error={errors.early} onRelease={releaseEarly} />
              <BeatRelease
                d={d}
                cache={cache}
                you={you}
                judgeRole={judgeRole}
                secondsLeft={secondsLeft ?? 0}
                botBusy={!!inflight.bot}
                botWaiting={botWaiting}
                botError={errors.bot}
                botPending={pendingTx.bot}
                onBotRetry={() => {
                  setErrors((x) => ({ ...x, bot: undefined }));
                  setBotGaveUp(false);
                }}
                busy={!!inflight.judge}
                error={errors.judge}
                pending={pendingTx.judge}
                onRelease={releaseJudge}
              />
              <BeatOpen d={d} state={state} cache={cache} you={you} busy={!!inflight.openA1} error={errors.openA1} onOpen={openA1} />
              <BeatRevoke d={d} cache={cache} you={you} inflight={inflight} errors={errors} pendingTx={pendingTx} onRemove={removeA2} onScripts={submitScripts} onOpenA2={openA2} />
              <BeatLeak d={d} cache={cache} busy={!!inflight.leak} error={errors.leak} onLeak={leak} />
              <BeatAudit d={d} examId={state.examId} count={eventCount} />
            </ol>
          </div>
        </>
      )}
    </AppPage>
  );
}

function DemoSkeleton() {
  return (
    <div className="pt-wrap pt-section" aria-busy="true" aria-label="Loading the demo">
      <div className="pt-col" style={{ gap: 12, marginBottom: 32 }}>
        <div className="pt-skel pt-skel--line" style={{ width: 160 }} />
        <div className="pt-skel pt-skel--title" />
      </div>
      <ol className="pt-stepper">
        {[1, 2, 3, 4].map((n) => (
          <BeatSkeleton key={n} n={n} />
        ))}
      </ol>
    </div>
  );
}

/** Plain words for the documents A2 tries in beat 5 (the API's `what` strings). */
function plainDocument(what: string) {
  if (/group key/i.test(what)) return "The team's new key (made after A2 was removed)";
  if (/script/i.test(what)) return "A candidate's answer script";
  return what.charAt(0).toUpperCase() + what.slice(1);
}

/** "Can read" / "Locked out", with the system's code on hover. */
function OutcomeTag({ code }: { code: string }) {
  const ok = code === 'opened';
  return (
    <span className="pt-code" title={ok ? 'opened' : code}>
      {ok ? 'Can read' : code === 'NOT_A_MEMBER' ? 'Locked out: not on the team' : code === 'NOT_A_RECIPIENT' ? 'Locked out: not sent to A2' : `Locked out (${code})`}
    </span>
  );
}

const doneChip = (at?: string, text = 'Done') => <Chip status="done">{at ? `${text} · ${utcClock(at)}` : text}</Chip>;

// ── beat 1: set ──

function BeatSet({ d, state, cache, live, collapsed, onToggle }: { d: Derived; state: DemoState; cache: DemoCache; live: boolean; collapsed: boolean; onToggle: () => void }) {
  const txs = d.set?.txs ?? cache.start?.txs.map((t) => t.tx) ?? [];
  const centre = (k: 'A' | 'B') => state.exam.centres.find((c) => c.centreId.toLowerCase() === state.centres[k].toLowerCase());
  return (
    <Beat
      n={1}
      state={d.states[1]}
      title="Set the exam"
      aside={!collapsed && doneChip(d.set?.at)}
      collapsed={collapsed}
      onToggle={onToggle}
      toggleLabel="Show the two copies"
      line={`Two centres, two different locked copies, three examiner keys · ${txs.length} blockchain receipts`}
    >
      <p className="pt-beat__lead">
        The exam board created the exam and sent each of the two <Term k="centre">exam centres</Term> its own locked copy. The key to unlock them is split between three <Term k="examiner">examiners</Term>: any two of them together can open a copy, but one alone can't.
      </p>
      <span className="pt-eyebrow">Blockchain receipts (each one opens on the QoreChain explorer)</span>
      <div className="pt-txlist">
        {txs[0] && <HashLink value={txs[0]} label="createExam" small />}
        {txs[1] && <HashLink value={txs[1]} label="setCentre A" small />}
        {txs[2] && <HashLink value={txs[2]} label="setCentre B" small />}
        {txs.length > 3 && <TxGroup label={`rotateEpoch ×${txs.length - 3}`} txs={txs.slice(3)} />}
      </div>
      <div className="pt-beat__rule">
        {cache.start ? (
          <CanaryDiff variants={cache.start.variants} spotNote={!live} />
        ) : (
          <div className="pt-col">
            <h3 className="pt-h3">Each centre's copy is slightly different</h3>
            <Note>
              The side-by-side copies are shown in the tab that started this demo. The server only keeps them locked, so this tab can't show them. The codes below are what the blockchain recorded for each copy.
            </Note>
            <div className="pt-txlist">
              <HashLink value={state.exam.masterCommitment} kind="plain" label="master copy code" small />
              {centre('A') && <HashLink value={centre('A')!.commitment} kind="plain" label="A" small />}
              {centre('B') && <HashLink value={centre('B')!.commitment} kind="plain" label="B" small />}
            </div>
          </div>
        )}
      </div>
      <OnChainDetails
        rows={[
          ['Called', `createExam, setCentre ×2, rotateEpoch ×3 on PaperTrail ${shortHash(CONTRACT)}`],
          ['Events', 'ExamCreated, CentreSet ×2, EpochChanged ×3'],
          ['Auth', "The board's ML-DSA-87 signature, verified by the pqcVerify precompile"],
          ['Stored', 'Only ciphertexts, sealed key shares and SHA3-256 commitments'],
        ]}
      />
    </Beat>
  );
}

// ── beat 2: release early ──

function BeatEarly({ d, cache, live, collapsed, onToggle, busy, error, onRelease }: { d: Derived; cache: DemoCache; live: boolean; collapsed: boolean; onToggle: () => void; busy: boolean; error?: ApiError; onRelease: () => void }) {
  const label = useBusyLabel(busy, 'Asking the contract…');
  const st = d.states[2];
  const note = cache.early?.[cache.early.length - 1];
  if (st === 'pending')
    return <Beat n={2} state="pending" title="Try to open it early" line="The start time passed before anyone tried opening it early. (The blockchain only refuses before the start time.)" />;
  return (
    <Beat
      n={2}
      state={st}
      title="Try to open it early"
      aside={st === 'refused' ? <Chip status="failed">{d.early ? `Refused · ${utcClock(d.early.at)}` : 'Refused'}</Chip> : <Chip status="pending">Your turn</Chip>}
      collapsed={collapsed}
      onToggle={onToggle}
      line="The blockchain refused: still locked. Nothing was sent."
    >
      {st === 'running' && (
        <>
          <p className="pt-beat__lead">What if someone tries to open the paper before the start time? Ask the blockchain to unlock Centre A's copy now, as Examiner 1. It should say no.</p>
          <Button variant="primary" size="lg" icon={<IconKey size={20} stroke={2} aria-hidden />} busy={busy} busyLabel={label} onClick={onRelease} className="pt-beat__cta">
            Release as Examiner 1 now
          </Button>
        </>
      )}
      {st === 'refused' && (
        <>
          <div className="pt-refusal" role="alert">
            <IconLock size={28} stroke={2} aria-hidden style={{ flex: 'none' }} />
            <div>
              <p className="pt-refusal__title">Refused by the blockchain</p>
              <p>{humaniseIsoTimes(note && !note.ok ? note.error.message : (d.earlyMessage ?? ''))}</p>
            </div>
          </div>
          <p className="pt-muted pt-beat__text">
            This was a real check against the QoreChain blockchain. It refused because the start time hasn't arrived, so nothing was sent and nothing was spent. No one, not even the exam board, can open it early.
          </p>
          {!live && (
            <Button size="sm" busy={busy} busyLabel={label} onClick={onRelease} className="pt-selfstart">
              Try again as Examiner 1
            </Button>
          )}
        </>
      )}
      <ActionError error={error} onRetry={onRelease} />
      {st === 'refused' && (
        <OnChainDetails
          rows={[
            ['Called', 'release(examId, centreA, blobHash, examiner1, epoch, sig), simulated with eth_call'],
            ['Result', `Reverted: block.timestamp < startTime (TooEarly)${note && !note.ok ? `. ${note.note}` : ''}`],
            ['Sent', 'Nothing. No transaction, no gas.'],
          ]}
        />
      )}
    </Beat>
  );
}

// ── beat 3: start time ──

type ReleaseProps = {
  d: Derived;
  cache: DemoCache;
  you: DemoRole;
  judgeRole: DemoRole;
  secondsLeft: number;
  botBusy: boolean;
  botWaiting: boolean;
  botError?: ApiError;
  botPending?: string;
  onBotRetry: () => void;
  busy: boolean;
  error?: ApiError;
  pending?: string;
  onRelease: () => void;
};

function BeatRelease({ d, you, judgeRole, secondsLeft, botBusy, botWaiting, botError, botPending, onBotRetry, busy, error, pending, onRelease }: ReleaseProps) {
  const label = useBusyLabel(busy, 'Sending to QoreChain…');
  const botLabel = useBusyLabel(botBusy, 'Examiner 1 (bot) is releasing…');
  const st = d.states[3];
  if (st === 'pending')
    return (
      <Beat
        n={3}
        state="pending"
        title="Two keys open it"
        aside={<span className="pt-beat__hint">in {mmss(secondsLeft)}</span>}
        line="At 00:00 Examiner 1 (a bot) uses their key. Then you use yours as Examiner 2, and two of the three keys unlock Centre A's paper."
      />
    );
  const releasedEpoch = d.remove ? Math.max(1, d.epochA - 1) : d.epochA;
  const judgeName = roleLabel(d.judgeRole ?? judgeRole, you);
  const chip =
    st === 'done' ? doneChip(d.judge?.at) : !d.bot ? <Chip status="pending">{botWaiting ? 'Waiting for the chain clock…' : 'Sending…'}</Chip> : busy || pending ? <Chip status="pending">Sending…</Chip> : <Chip status="pending">Your turn</Chip>;
  return (
    <Beat n={3} state={st} title="Two keys open it" aside={chip}>
      <div className="pt-xrows">
        {d.bot ? (
          <XRow yes aside={d.bot.txs[0] && <HashLink value={d.bot.txs[0]} small copy={false} />}>
            <strong>Examiner 1 (bot)</strong> used their key for Centre A · 1 of 2
          </XRow>
        ) : botError ? (
          <ActionError error={botError} onRetry={onBotRetry} />
        ) : botPending ? (
          <PendingTx tx={botPending} />
        ) : (
          <Banner tone="wait">{botWaiting ? 'Waiting for the chain clock… The bot release retries every 3 s.' : botLabel}</Banner>
        )}
        {d.judge && (
          <XRow yes aside={d.judge.txs[0] && <HashLink value={d.judge.txs[0]} small copy={false} />}>
            <strong>{d.judgeRole === you ? `You, ${ROLE_NAME[d.judgeRole]}` : judgeName}</strong> used your key for Centre A · 2 of 2
          </XRow>
        )}
      </div>
      {st === 'done' ? (
        <Verdict tone="ok" title="Unlocked (2 of 2 keys)" big={false}>
          <p>
            Centre A's paper can now be opened, but only by Centre A's <Term k="invigilator">invigilators</Term> (<Term k="team">team version</Term> {releasedEpoch}).
          </p>
        </Verdict>
      ) : (
        d.bot && (
          <>
            <p className="pt-beat__lead">The start time has passed and one key is in. One more opens Centre A's paper, and you hold {ROLE_NAME[judgeRole]}'s.</p>
            {pending ? (
              <PendingTx tx={pending} />
            ) : (
              <Button variant="primary" size="lg" full icon={<IconKey size={22} stroke={2} aria-hidden />} busy={busy} busyLabel={label} onClick={onRelease} className="pt-beat__cta">
                Use my key: release as {ROLE_NAME[judgeRole]} (you)
              </Button>
            )}
            <p className="pt-muted pt-small">This sends a real, signed transaction to the blockchain. Usually 3–10 s; the button ignores repeat taps.</p>
          </>
        )
      )}
      <ActionError error={error} onRetry={onRelease} />
      {(d.bot || st === 'done') && (
        <OnChainDetails
          rows={[
            ['Called', 'release(examId, centreA, blobHash, examiner, epoch, sig), once per examiner'],
            ['Events', `ShareReleased ×${d.judge ? 2 : 1}${d.releasedA ? ', Released' : ''}`],
            ['Auth', "Each examiner's ML-DSA-87 signature over the release, including the epoch, verified by the pqcVerify precompile"],
            ['Sealed to', "Centre A's invigilator group at its current epoch, members checked against the chain"],
          ]}
        />
      )}
    </Beat>
  );
}

// ── beat 4: invigilator view ──

function BeatOpen({ d, state, cache, you, busy, error, onOpen }: { d: Derived; state: DemoState; cache: DemoCache; you: DemoRole; busy: boolean; error?: ApiError; onOpen: () => void }) {
  const label = useBusyLabel(busy, 'Opening Centre A’s copy…');
  const st = d.states[4];
  if (st === 'pending') return <Beat n={4} state="pending" title="Open it at the centre" aside={<span className="pt-beat__hint">After it's unlocked</span>} line="An invigilator at Centre A opens the paper and checks it's genuine." />;
  const commitment = cache.openA1?.commitment ?? state.exam.centres.find((c) => c.centreId.toLowerCase() === state.centres.A.toLowerCase())?.commitment;
  return (
    <Beat n={4} state={st} title="Open it at the centre" aside={st === 'done' ? <Chip status="done">Opened by Invigilator A1</Chip> : <Chip status="pending">{you === 'invigilatorA1' ? 'Your turn' : 'Next'}</Chip>}>
      {st === 'running' && (
        <>
          <p className="pt-beat__lead">It's exam morning at Centre A. Invigilator A1 opens the paper, and the app checks it's exactly the paper that was set, using the code recorded on the blockchain.</p>
          <Button variant="primary" size="lg" busy={busy} busyLabel={label} onClick={onOpen} className="pt-beat__cta">
            Open as {roleLabel('invigilatorA1', you)}
          </Button>
        </>
      )}
      {st === 'done' && (
        <>
          <Verdict tone="ok" sticker={stamp} title="Authentic">
            <p>
              This is exactly the paper that was set. Its <Term k="hash">code</Term> matches the one recorded on the blockchain, so not a single character has changed.
            </p>
            {commitment && <HashLink value={commitment} kind="plain" label="recorded code" small />}
          </Verdict>
          {cache.openA1?.paper ? (
            <>
              <PaperView markdown={cache.openA1.paper} label="Centre A's decrypted paper" />
              <Link
                className="pt-btn pt-btn--sm pt-selfstart"
                to={`/verify?exam=${state.examId}&centre=${state.centres.A}`}
                onClick={() => {
                  try {
                    sessionStorage.setItem(VERIFY_DRAFT_KEY, cache.openA1?.paper ?? '');
                  } catch {
                    /* the verify page just starts empty */
                  }
                }}
              >
                Check it yourself
              </Link>
            </>
          ) : (
            <div className="pt-row">
              <span className="pt-muted pt-small">The decrypted paper was shown in the tab that opened it.</span>
              <Button size="sm" busy={busy} busyLabel={label} onClick={onOpen}>
                Show the paper again
              </Button>
            </div>
          )}
        </>
      )}
      <ActionError error={error} onRetry={onOpen} />
      {st === 'done' && (
        <OnChainDetails
          rows={[
            ['Read', "Centre A's ciphertext and the two released shares (sealed to the invigilator group)"],
            ['Opened with', "Invigilator A1's demo key. In judge mode this server holds it; a real invigilator opens in their own browser"],
            ['Checked', 'SHA3-256 of the decrypted copy = commitment(examId, centreA) on PaperTrail'],
            ['Sent', 'Nothing. Opening a paper is not a transaction.'],
          ]}
        />
      )}
    </Beat>
  );
}

// ── beat 5: revoke ──

type RevokeProps = {
  d: Derived;
  cache: DemoCache;
  you: DemoRole;
  inflight: Partial<Record<ActKey, boolean>>;
  errors: Partial<Record<ActKey, ApiError>>;
  pendingTx: Partial<Record<ActKey, string>>;
  onRemove: () => void;
  onScripts: () => void;
  onOpenA2: () => void;
};

function BeatRevoke({ d, cache, you, inflight, errors, pendingTx, onRemove, onScripts, onOpenA2 }: RevokeProps) {
  const removeLabel = useBusyLabel(!!inflight.remove, 'Removing and rotating the epoch…');
  const scriptsLabel = useBusyLabel(!!inflight.scripts, 'Sealing and submitting 6 scripts…');
  const openLabel = useBusyLabel(!!inflight.openA2, 'Trying everything as A2…');
  const st = d.states[5];
  if (st === 'pending') return <Beat n={5} state="pending" title="Remove someone" line="The board removes Invigilator A2 from Centre A's team. Watch A2 get locked out of everything sent afterwards." />;
  const newEpoch = cache.remove?.epoch ?? d.epochA;
  const scriptTxs = d.scripts?.txs ?? cache.scripts?.submitted.map((s) => s.txHash) ?? [];
  const removeTx = d.remove?.txs[0] ?? cache.remove?.txHash;
  return (
    <Beat n={5} state={st} title="Remove someone" aside={d.remove ? <Chip status="epoch">{`Team v${Math.max(1, newEpoch - 1)} → v${newEpoch}`}</Chip> : <Chip status="pending">Next</Chip>}>
      {/* 1. remove */}
      <div className="pt-substep">
        <div className="pt-substep__head">
          <h3 className="pt-substep__title">{d.remove ? '1. Board removed Invigilator A2' : '1. Remove Invigilator A2'}</h3>
          {removeTx && <HashLink value={removeTx} label="rotateEpoch" small copy={false} />}
        </div>
        {d.remove ? (
          <div className="pt-row">
            <span className="pt-muted pt-small">Centre A's team now:</span>
            <RoleTag kind="invigilator">Invigilator A1</RoleTag>
            <Chip status="revoked">Invigilator A2</Chip>
          </div>
        ) : pendingTx.remove ? (
          <PendingTx tx={pendingTx.remove} />
        ) : (
          <>
            <p className="pt-muted pt-beat__text">Say Invigilator A2 has left Centre A. The exam board removes them, which gives Centre A's team a new version without A2. Anything sent from now on is locked to the new team only.</p>
            <Button variant="danger" busy={!!inflight.remove} busyLabel={removeLabel} onClick={onRemove} className="pt-selfstart">
              Remove Invigilator A2{you === 'board' ? ' (you)' : ''}
            </Button>
          </>
        )}
        <ActionError error={errors.remove} onRetry={onRemove} />
      </div>
      {/* 2. scripts */}
      <div className="pt-substep">
        <div className="pt-substep__head">
          <h3 className="pt-substep__title">{d.scripts ? `2. Candidates submitted ${scriptTxs.length} scripts` : '2. Candidates submit scripts'}</h3>
          {d.scripts && <span className="pt-muted pt-small">locked so only the two markers can read them</span>}
        </div>
        {d.scripts ? (
          <div className="pt-txlist">
            {scriptTxs.map((t) => (
              <HashLink key={t} value={t} small copy={false} />
            ))}
          </div>
        ) : pendingTx.scripts ? (
          <PendingTx tx={pendingTx.scripts} />
        ) : d.remove ? (
          <>
            <p className="pt-muted pt-beat__text">After the exam, six candidates (bots) hand in their answers. Each script is locked so only the markers can read it, and carries a <Term k="pseudonym">code name</Term> instead of the candidate's name. Six blockchain receipts, so this takes a little longer.</p>
            <Button variant="primary" busy={!!inflight.scripts} busyLabel={scriptsLabel} onClick={onScripts} className="pt-selfstart">
              Candidates submit scripts
            </Button>
          </>
        ) : (
          <p className="pt-muted pt-small">After the removal.</p>
        )}
        <ActionError error={errors.scripts} onRetry={onScripts} />
      </div>
      {/* 3. A2 tries */}
      <div className="pt-substep">
        <h3 className="pt-substep__title">{d.openA2 ? '3. A2 tried to open everything' : '3. Can A2 still get in?'}</h3>
        {d.openA2 && d.a2Paper ? (
          <>
            <div className="pt-xrows">
              <XRow yes={d.a2Paper.opened} aside={<OutcomeTag code={d.a2Paper.opened ? 'opened' : (d.a2Paper.code ?? 'refused')} />}>
                The exam paper (sent while A2 was still on the team)
              </XRow>
              {d.a2Later.map((l) => (
                <XRow key={l.what} yes={l.result === 'opened'} aside={<OutcomeTag code={l.result} />}>
                  {plainDocument(l.what)}
                </XRow>
              ))}
            </div>
            {d.a2Paper.opened && <Note>A2 can still read the paper that was sent while A2 was on the team. Removing someone can't take back what they already had; it locks them out of everything sent afterwards.</Note>}
          </>
        ) : d.scripts ? (
          <>
            <p className="pt-muted pt-beat__text">A2 tries to open three things: the exam paper from earlier, the team's new key, and a candidate's answer script.</p>
            <Button variant="primary" busy={!!inflight.openA2} busyLabel={openLabel} onClick={onOpenA2} className="pt-selfstart">
              Try to open as {roleLabel('invigilatorA2', you)}
            </Button>
          </>
        ) : (
          <p className="pt-muted pt-small">After the scripts are in.</p>
        )}
        <ActionError error={errors.openA2} onRetry={onOpenA2} />
      </div>
      {d.remove && (
        <OnChainDetails
          rows={[
            ['Called', `rotateEpoch (Centre A group → epoch ${newEpoch})${d.scripts ? `, submitScript ×${scriptTxs.length}` : ''}`],
            ['Events', `EpochChanged${d.scripts ? `, ScriptSubmitted ×${scriptTxs.length}` : ''}`],
            ['Auth', "The board's ML-DSA-87 signature on each action, verified by the pqcVerify precompile"],
            ['Recipients', 'Scripts are sealed to the marker group after checking its members against the chain'],
          ]}
        />
      )}
    </Beat>
  );
}

// ── beat 6: leak ──

function BeatLeak({ d, cache, busy, error, onLeak }: { d: Derived; cache: DemoCache; busy: boolean; error?: ApiError; onLeak: () => void }) {
  const label = useBusyLabel(busy, 'Tracing the excerpt…');
  const st = d.states[6];
  if (st === 'pending') return <Beat n={6} state="pending" title="Trace a leak" line="Someone leaks part of Centre B's copy online. Can we tell where it came from?" />;
  const last = cache.leaks?.[cache.leaks.length - 1];
  const fromSteps = !last && d.leaks.length ? parseLeakSummary(d.leaks[d.leaks.length - 1].summary) : null;
  const result = last?.result ?? fromSteps;
  const roleByAddress = (addr: string) => {
    const roles = cache.start?.roles;
    if (!roles) return null;
    const hit = (Object.keys(roles) as DemoRole[]).find((r) => roles[r].roleAddress === addr || roles[r].address.toLowerCase() === addr.toLowerCase());
    return hit ? ROLE_NAME[hit] : null;
  };
  return (
    <Beat
      n={6}
      state={st}
      title="Trace a leak"
      aside={
        st === 'done' ? (
          <Button size="sm" busy={busy} busyLabel={label} onClick={onLeak}>
            Simulate another leak
          </Button>
        ) : (
          <Chip status="pending">Next</Chip>
        )
      }
    >
      {st === 'running' && (
        <>
          <p className="pt-beat__lead">Someone at Centre B retypes three questions and posts them online, typos and all. Because every centre's copy is slightly different, the leaked text still gives away which copy it came from.</p>
          <Button variant="primary" size="lg" busy={busy} busyLabel={label} onClick={onLeak} className="pt-beat__cta">
            Simulate a leak from Centre B
          </Button>
        </>
      )}
      {st === 'done' && result && (
        <div className="pt-leak">
          <div className="pt-col" style={{ gap: 10 }}>
            <span className="pt-eyebrow">The leaked text, as found online</span>
            {last ? <pre className="pt-excerpt">{last.leakedExcerpt}</pre> : <p className="pt-muted pt-small">The excerpt was shown in the tab that ran the leak. Simulate another to see one here.</p>}
          </div>
          <div className="pt-col" style={{ gap: 14 }}>
            {result.copy ? (
              <Verdict tone="bad" sticker={canary} title={`Traced to ${result.copy}`} big>
                <p>
                  {result.matchedBits === result.observedBits ? `All ${result.observedBits}` : `${result.matchedBits} of ${result.observedBits}`} hidden differences in the leak match this copy
                </p>
              </Verdict>
            ) : (
              <Verdict tone="neutral" title="No clear match" big>
                <p>This text is too close to more than one copy to say which one leaked. We won't guess.</p>
              </Verdict>
            )}
            <ConfidenceBar value={result.confidence} />
            {Number.isFinite(result.distanceToRunnerUp) && <p className="pt-muted pt-small">The next closest copy differs from the leak in {result.distanceToRunnerUp} more places.</p>}
            {last?.centre && (
              <dl className="pt-kv">
                {last.centre.epoch !== undefined && (
                  <>
                    <dt>Team version</dt>
                    <dd className="pt-mono">{last.centre.epoch}</dd>
                  </>
                )}
                {!!last.centre.recipients?.length && (
                  <>
                    <dt>Who received it</dt>
                    <dd className="pt-col" style={{ gap: 4 }}>
                      {last.centre.recipients.map((r) => (
                        <span key={r.address} className="pt-row" style={{ gap: 8 }}>
                          <HashLink value={r.roleAddress || r.address} kind="address" small copy={false} />
                          {roleByAddress(r.roleAddress) ?? roleByAddress(r.address)}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
                {last.centre.setTx && (
                  <>
                    <dt>Copy recorded in</dt>
                    <dd>
                      <HashLink value={last.centre.setTx} small copy={false} />
                    </dd>
                  </>
                )}
                {last.centre.epochTx && (
                  <>
                    <dt>Team set up in</dt>
                    <dd>
                      <HashLink value={last.centre.epochTx} small copy={false} />
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>
        </div>
      )}
      <ActionError error={error} onRetry={onLeak} />
      {st === 'done' && <Note>A leaked copy points to the centre it was sent to, or to the exam board and examiners, who hold every copy. It can't tell those apart.</Note>}
    </Beat>
  );
}

// ── beat 7: audit ──

function BeatAudit({ d, examId, count }: { d: Derived; examId: string; count: number | null }) {
  const st = d.states[7];
  if (st === 'pending') return <Beat n={7} state="pending" title="Public record" line="Every step above is recorded on the public blockchain. See them all in one list." />;
  return (
    <Beat n={7} state={st} title="Public record">
      <div className="pt-row" style={{ justifyContent: 'space-between' }}>
        <p className="pt-beat__lead">Every step above is recorded on the public blockchain, where nobody can change it afterwards{count !== null ? `: ${count} records for this exam.` : '.'}</p>
        <Link className="pt-btn pt-btn--primary" to={`/exams/${examId}/audit`}>
          Open the audit trail
          <IconArrowRight size={18} stroke={2} aria-hidden />
        </Link>
      </div>
    </Beat>
  );
}

