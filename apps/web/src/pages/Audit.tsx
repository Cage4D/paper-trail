import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { IconArrowLeft } from '@tabler/icons-react';
import padlock from '../assets/stickers/padlock.svg';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Term } from '../components/Term';
import { HashLink } from '../components/HashLink';
import { AppPage } from '../components/Shell';
import { ApiError, api } from '../lib/api';
import { CHAIN_ID } from '../lib/config';
import { shortHash } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
import type { AuditEvent, AuditView, EventsPage, ExamView } from '../lib/types';

export const EXAM_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/** Event chip fills (design handoff §8): set/epoch lavender, share yellow, released mint, scripts/marks white. */
const FILL: Record<string, string> = {
  ExamCreated: 'epoch',
  CentreSet: 'epoch',
  EpochChanged: 'epoch',
  ShareReleased: 'pending',
  Released: 'released',
  ScriptSubmitted: 'sealed',
  MarksPublished: 'sealed',
};

/** Plain names for the contract's events (the technical name stays on hover). */
const LABEL: Record<string, string> = {
  ExamCreated: 'Exam created',
  CentreSet: 'Copy sent',
  EpochChanged: 'Team updated',
  ShareReleased: 'Key used',
  Released: 'Paper unlocked',
  ScriptSubmitted: 'Answers handed in',
  MarksPublished: 'Marks published',
};

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const M = ({ children }: { children: ReactNode }) => <span className="pt-mono pt-mono--inline">{children}</span>;

type Row = { kind: 'one'; e: AuditEvent; isNew: boolean } | { kind: 'scripts'; items: AuditEvent[]; isNew: boolean };

export function AuditIndex() {
  const navigate = useNavigate();
  const recent = getRecentDemo();
  const [id, setId] = useState(recent?.examId ?? '');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!EXAM_ID_RE.test(id.trim())) return setErr('Enter an exam id: 0x followed by 64 hex characters.');
    navigate(`/exams/${id.trim().toLowerCase()}/audit`);
  };
  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 24, maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
        <img src={padlock} alt="" aria-hidden="true" className="pt-empty__art" />
        <h1 className="pt-h1">Audit trail</h1>
        <p className="pt-lead">Every step of one exam, oldest first, as recorded on the public blockchain. Paste an exam id to see its record.</p>
        <form className="pt-col" onSubmit={submit} noValidate>
          <Field label="Exam id" error={err} help={recent ? 'Filled in with the demo you ran in this tab.' : undefined} className="pt-field--flex">
            <input className="pt-input pt-input--mono" value={id} onChange={(e) => (setId(e.target.value), setErr(null))} placeholder="0x8c41f2…" spellCheck={false} autoComplete="off" />
          </Field>
          <button type="submit" className="pt-btn pt-btn--primary pt-selfstart">
            Open audit trail
          </button>
        </form>
      </section>
    </AppPage>
  );
}

export function Audit() {
  const { examId = '' } = useParams();
  const [audit, setAudit] = useState<AuditView | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [pollMs, setPollMs] = useState(4000);
  const [filter, setFilter] = useState<'all' | string>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const cursor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const a = await api<AuditView>(`/exams/${examId}/audit`, { timeoutMs: 60_000 });
      setAudit(a);
      setEvents(a.timeline);
      cursor.current = a.timeline.length ? a.timeline[a.timeline.length - 1].cursor : null;
      api<ExamView>(`/exams/${examId}`, { timeoutMs: 60_000 }).then((x) => setTitle(x.title), () => undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));
    }
  }, [examId]);

  useEffect(() => {
    if (EXAM_ID_RE.test(examId)) void load();
  }, [examId, load]);

  usePoll(
    async () => {
      try {
        const q = cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : '';
        const r = await api<EventsPage>(`/exams/${examId}/events${q}`, { timeoutMs: 60_000 });
        if (r.pollAfterMs) setPollMs(r.pollAfterMs);
        const seen = new Set(events.map((e) => e.cursor));
        const add = r.events.filter((e) => !seen.has(e.cursor));
        if (r.cursor) cursor.current = r.cursor;
        if (add.length) {
          setEvents((x) => [...x, ...add]);
          const keys = add.map((e) => e.cursor);
          setFresh((f) => new Set([...f, ...keys]));
          setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !keys.includes(k)))), 3000);
          // marks root may have just been published: refresh the check panel
          if (add.some((e) => e.name === 'MarksPublished' || e.name === 'CentreSet')) api<AuditView>(`/exams/${examId}/audit`).then(setAudit, () => undefined);
        }
      } catch {
        /* keep the timeline; the next poll retries */
      }
    },
    pollMs,
    !!audit,
  );

  const centres = audit?.check.centres ?? [];
  const centreName = useCallback((id: string | null) => centres.find((c) => c.centreId.toLowerCase() === (id ?? '').toLowerCase())?.name ?? null, [centres]);
  const groupName = (id: string | null) => {
    const n = centreName(id);
    return n ? `${n}'s team` : "The markers' team";
  };

  const describe = (e: AuditEvent): ReactNode => {
    const d = e.data;
    switch (e.name) {
      case 'ExamCreated': {
        const ex = (d.examiners as string[] | undefined) ?? [];
        return (
          <>
            The exam board <M>{shortHash(s(d.board))}</M> created the exam and named three examiners: {ex.map((x, i) => (
              <Fragment key={x}>
                {i ? ', ' : ''}
                <M>{shortHash(x)}</M>
              </Fragment>
            ))}
          </>
        );
      }
      case 'CentreSet':
        return (
          <>
            {centreName(e.centreId) ?? 'A centre'}'s locked copy was sent and its code recorded: <M>{shortHash(s(d.commitment))}</M>
          </>
        );
      case 'EpochChanged':
        return (
          <>
            {Number(d.epoch) > 1 ? `${groupName(s(d.centreId) || e.centreId)} changed: now team version ${s(d.epoch)}` : `${groupName(s(d.centreId) || e.centreId)} set up (team version 1)`}
          </>
        );
      case 'ShareReleased':
        return (
          <>
            Examiner <M>{shortHash(s(d.examiner))}</M> used their key for {centreName(e.centreId) ?? 'a centre'}
          </>
        );
      case 'Released':
        return (
          <>
            {centreName(e.centreId) ?? 'A centre'}'s paper unlocked: 2 of 2 keys used. Only its team (version {s(d.epoch)}) can open it
          </>
        );
      case 'ScriptSubmitted':
        return (
          <>
            An answer script from {centreName(e.centreId) ?? 'a centre'}, locked for the markers, under a code name
          </>
        );
      case 'MarksPublished':
        return (
          <>
            The board published everyone's marks as one marks code: <M>{shortHash(s(d.merkleRoot))}</M>
          </>
        );
      default:
        return <>{e.name}</>;
    }
  };

  const rows: Row[] = useMemo(() => {
    const shown = events.filter((e) => filter === 'all' || !e.centreId || !centreName(e.centreId) || e.centreId.toLowerCase() === filter.toLowerCase() || (e.name === 'EpochChanged' && s(e.data.centreId).toLowerCase() === filter.toLowerCase()));
    const out: Row[] = [];
    for (const e of shown) {
      const last = out[out.length - 1];
      if (e.name === 'ScriptSubmitted' && last?.kind === 'scripts' && last.items[0].centreId === e.centreId) {
        last.items.push(e);
        last.isNew ||= fresh.has(e.cursor);
      } else if (e.name === 'ScriptSubmitted') out.push({ kind: 'scripts', items: [e], isNew: fresh.has(e.cursor) });
      else out.push({ kind: 'one', e, isNew: fresh.has(e.cursor) });
    }
    return out;
  }, [events, filter, fresh, centreName]);

  if (!EXAM_ID_RE.test(examId))
    return (
      <AppPage>
        <section className="pt-wrap pt-section pt-col">
          <h1 className="pt-h1">Audit trail</h1>
          <Banner tone="error">That isn't an exam id. It should be 0x followed by 64 hex characters.</Banner>
          <Link className="pt-btn pt-selfstart" to="/audit">
            Enter an exam id
          </Link>
        </section>
      </AppPage>
    );

  const eventRow = (e: AuditEvent, isNew: boolean, extra?: ReactNode) => (
    <tr key={e.cursor} className={isNew ? 'pt-tr--new' : undefined}>
      <td>
        <span title={`${e.name} (the contract's event name)`}>
          <Chip status={(FILL[e.name] ?? 'sealed') as never} icon={null}>
            {LABEL[e.name] ?? e.name}
          </Chip>
        </span>
      </td>
      <td>
        {isNew && <strong>New · </strong>}
        {describe(e)}
        {extra}
      </td>
      <td className="pt-mono pt-small">{Number(e.block).toLocaleString('en-GB')}</td>
      <td>
        <HashLink value={e.txHash} small copy={false} />
      </td>
    </tr>
  );

  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 20 }}>
        <Link className="pt-backlink" to={`/exams/${examId}`}>
          <IconArrowLeft size={18} stroke={2} aria-hidden />
          {title ?? 'Exam'}
        </Link>
        <h1 className="pt-h1 pt-h1--xl">Audit trail</h1>
        <p className="pt-lead">Every step of this exam, oldest first, exactly as it was written to the public QoreChain blockchain. Each step was signed with a quantum-safe signature and checked before it was recorded, and nobody can change it afterwards.</p>
        <div className="pt-row" style={{ gap: '10px 24px' }}>
          <HashLink value={examId} to={`/exams/${examId}`} label="exam" small />
          {audit && (
            <span className="pt-row" style={{ gap: 8 }}>
              <HashLink value={audit.contract} kind="address" label="contract" small copy={false} />
              <span className="pt-hash__label">chain id {audit.chainId ?? CHAIN_ID}</span>
            </span>
          )}
          {audit && (
            <span className="pt-chip pt-chip--released pt-livechip">
              <span className="pt-health__dot" aria-hidden />
              Live · checks every {Math.round(pollMs / 1000)} s
            </span>
          )}
        </div>

        {error && (
          <Banner tone="error" action={error.retryable ? <Button size="sm" onClick={() => void load()}>Try again</Button> : undefined}>
            {error.code === 'NOT_FOUND' ? "That doesn't exist. Check the exam id; new exams appear once their first event is indexed." : error.message}
          </Banner>
        )}

        {!audit && !error && (
          <div className="pt-col" aria-busy="true" aria-label="Loading the audit trail">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="pt-skel" style={{ height: 52 }} />
            ))}
          </div>
        )}

        {audit && (
          <div className="pt-auditgrid">
            <div className="pt-col" style={{ gap: 16 }}>
              <div className="pt-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="pt-h3 pt-h3--lg">{events.length} records</h2>
                <div className="pt-row pt-filters" role="group" aria-label="Filter by centre">
                  {[{ id: 'all', name: 'All centres' }, ...centres.map((c) => ({ id: c.centreId, name: c.name }))].map((f) => (
                    <button key={f.id} type="button" className={`pt-btn pt-btn--sm${filter === f.id ? '' : ' pt-btn--ghost'}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-tablebox">
                <table className="pt-table">
                  <caption className="sr-only">On-chain events for this exam, oldest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">What happened</th>
                      <th scope="col">Block</th>
                      <th scope="col">Receipt</th>
                    </tr>
                  </thead>
                  <tbody aria-live="polite" aria-relevant="additions">
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="pt-muted">
                          No events yet. They appear here as soon as they're indexed.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => {
                      if (r.kind === 'one') return eventRow(r.e, r.isNew);
                      if (r.items.length === 1) return eventRow(r.items[0], r.isNew);
                      const key = r.items[0].cursor;
                      const isOpen = open.has(key);
                      const first = r.items[0];
                      const last = r.items[r.items.length - 1];
                      return (
                        <Fragment key={key}>
                          <tr className={r.isNew ? 'pt-tr--new' : undefined}>
                            <td>
                              <span title="ScriptSubmitted (the contract's event name)">
                                <Chip status="sealed" icon={null}>
                                  Answers handed in
                                </Chip>
                              </span>
                            </td>
                            <td>
                              {r.isNew && <strong>New · </strong>}
                              {r.items.length} answer scripts from {centreName(first.centreId) ?? 'a centre'}, each locked for the markers under a code name{' '}
                              <button type="button" className="pt-linkbtn" aria-expanded={isOpen} onClick={() => setOpen((o) => (o.has(key) ? new Set([...o].filter((k) => k !== key)) : new Set([...o, key])))}>
                                {isOpen ? 'Hide' : `Show ${r.items.length}`}
                              </button>
                            </td>
                            <td className="pt-mono pt-small">
                              {Number(first.block).toLocaleString('en-GB')}
                              {last.block !== first.block ? `–${last.block.slice(-3)}` : ''}
                            </td>
                            <td>
                              <HashLink value={first.txHash} small copy={false} />
                            </td>
                          </tr>
                          {isOpen && r.items.map((e) => eventRow(e, fresh.has(e.cursor)))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="pt-muted pt-small">New steps appear at the bottom, highlighted for 3 s. "Block" is the blockchain's page number for each record; each receipt opens on the QoreChain explorer.</p>
            </div>

            <aside className="pt-col" style={{ gap: 20 }}>
              <div className="pt-cardx">
                <h2 className="pt-h3 pt-h3--lg">Check it yourself</h2>
                <p className="pt-muted pt-small" title={audit.check.how}>
                  When the exam was set, a short code (a <Term k="hash">hash</Term>) of each centre's copy was recorded on the blockchain. Paste a copy into Verify a paper: if its code matches, it's exactly the paper that was set.
                </p>
                <dl className="pt-kv">
                  <dt>Master copy</dt>
                  <dd>
                    <HashLink value={audit.check.masterCommitment} kind="plain" small />
                  </dd>
                  {audit.check.centres.map((c) => (
                    <Fragment key={c.centreId}>
                      <dt>{c.name}</dt>
                      <dd className="pt-col" style={{ gap: 2 }}>
                        <HashLink value={c.commitment} kind="plain" small />
                        <span className="pt-hash__label" title={c.cipherHash}>
                          locked file {shortHash(c.cipherHash)}
                        </span>
                      </dd>
                    </Fragment>
                  ))}
                  <dt>Marks code</dt>
                  <dd>{audit.check.marksRoot ? <HashLink value={audit.check.marksRoot} kind="plain" small /> : <span className="pt-muted">Not published yet</span>}</dd>
                </dl>
                <div className="pt-row">
                  <Link className="pt-btn" to={`/verify?exam=${examId}`}>
                    Verify a paper
                  </Link>
                  <Link className="pt-btn pt-btn--ghost" to={`/marks?exam=${examId}`}>
                    Check a mark
                  </Link>
                </div>
              </div>
              <p className="pt-dashnote">Who did what, and when, is public on the blockchain. Only the papers and answer scripts themselves are secret.</p>
            </aside>
          </div>
        )}
      </section>
    </AppPage>
  );
}
