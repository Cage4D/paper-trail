import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { IconUpload } from '@tabler/icons-react';
import stamp from '../assets/stickers/authentic-stamp.svg';
import { Banner, Note } from '../components/Banner';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { HashLink } from '../components/HashLink';
import { AppPage } from '../components/Shell';
import { Verdict, XRow } from '../components/Verdict';
import { ApiError, api } from '../lib/api';
import { readCommitment } from '../lib/chain';
import { CONTRACT } from '../lib/config';
import { loadCore } from '../lib/crypto';
import { shortHash } from '../lib/format';
import { useElapsed } from '../lib/hooks';
import { VERIFY_DRAFT_KEY } from '../lib/recent';
import type { ExamView, Hex } from '../lib/types';
import { EXAM_ID_RE } from './Audit';


type Source = { value?: Hex; error?: string };
interface Result {
  hash: Hex;
  bytes: number;
  api: Source;
  chain: Source;
  centreName: string;
  /** A near miss: matches if the final line break is added or removed (lost when copying). */
  newlineHint?: 'add' | 'remove';
}

export function Verify() {
  const [params] = useSearchParams();
  const [examId, setExamId] = useState(params.get('exam') ?? '');
  const [centreId, setCentreId] = useState(params.get('centre') ?? '');
  const [exam, setExam] = useState<ExamView | null>(null);
  const [examError, setExamError] = useState<string | null>(null);
  const [text, setText] = useState(() => {
    try {
      const t = sessionStorage.getItem(VERIFY_DRAFT_KEY);
      if (t) sessionStorage.removeItem(VERIFY_DRAFT_KEY);
      return t ?? '';
    } catch {
      return '';
    }
  });
  const [textError, setTextError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [checkError, setCheckError] = useState<ApiError | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const s = useElapsed(busy);

  // load the exam's centres once the id looks right
  useEffect(() => {
    setExam(null);
    setExamError(null);
    const id = examId.trim();
    if (!EXAM_ID_RE.test(id)) return;
    const ctrl = new AbortController();
    api<ExamView>(`/exams/${id.toLowerCase()}`, { signal: ctrl.signal, timeoutMs: 60_000 }).then(
      (e) => {
        setExam(e);
        setCentreId((c) => (e.centres.some((x) => x.centreId.toLowerCase() === c.toLowerCase()) ? c : (e.centres[0]?.centreId ?? '')));
      },
      (e) => !ctrl.signal.aborted && setExamError(e instanceof ApiError ? e.message : "Couldn't load this exam."),
    );
    return () => ctrl.abort();
  }, [examId]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return setTextError('That file is too big to be a paper (over 2 MB).');
    setText(await f.text());
    setTextError(null);
    setResult(null);
  };

  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const id = examId.trim().toLowerCase() as Hex;
    if (!EXAM_ID_RE.test(id)) return setExamError('Enter an exam id: 0x followed by 64 hex characters.');
    if (!exam) return setExamError(examError ?? 'Wait for the exam to load, then pick a centre.');
    const centre = exam.centres.find((c) => c.centreId.toLowerCase() === centreId.toLowerCase());
    if (!centre) return setExamError('Pick a centre.');
    if (!text) return setTextError('Paste the paper text or choose a file.');
    setBusy(true);
    setCheckError(null);
    setResult(null);
    try {
      const { commitmentOf } = await loadCore();
      const hash = commitmentOf(text);
      const bytes = new TextEncoder().encode(text).length;
      let apiSrc: Source;
      try {
        const c = await api<{ commitment: Hex }>(`/exams/${id}/centres/${centre.centreId}/cipher`, { timeoutMs: 60_000 });
        apiSrc = { value: c.commitment };
      } catch (err) {
        apiSrc = { error: err instanceof ApiError ? err.message : 'Unavailable' };
      }
      let chainSrc: Source;
      try {
        chainSrc = { value: await readCommitment(id, centre.centreId) };
      } catch {
        chainSrc = { error: "Couldn't read the contract right now." };
      }
      const target = (chainSrc.value ?? apiSrc.value)?.toLowerCase();
      let newlineHint: Result['newlineHint'];
      if (target && hash.toLowerCase() !== target) {
        if (!text.endsWith('\n') && commitmentOf(`${text}\n`).toLowerCase() === target) newlineHint = 'add';
        else if (text.endsWith('\n') && commitmentOf(text.slice(0, -1)).toLowerCase() === target) newlineHint = 'remove';
      }
      setResult({ hash, bytes, api: apiSrc, chain: chainSrc, centreName: centre.name, newlineHint });
    } catch (err) {
      setCheckError(err instanceof ApiError ? err : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const matchApi = result && eq(result.hash, result.api.value);
  const matchChain = result && eq(result.hash, result.chain.value);
  const ok = result && matchChain && (matchApi || !result.api.value);
  const sourcesDisagree = result?.api.value && result.chain.value && !eq(result.api.value, result.chain.value);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  };

  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 28 }}>
        <div className="pt-pagehead">
          <div className="pt-col" style={{ gap: 12 }}>
            <h1 className="pt-h1 pt-h1--xl">Verify a paper</h1>
            <p className="pt-lead">
              Paste or drop a paper. Your browser hashes it with SHA3-256 and compares the result with the commitment recorded on-chain when the paper was set. The text never leaves this device.
            </p>
          </div>
          <img src={stamp} alt="" aria-hidden="true" className="pt-pagehead__art" />
        </div>

        <div className="pt-two">
          <form className="pt-col" style={{ gap: 20 }} onSubmit={check} noValidate>
            <div className="pt-row pt-row--fields">
              <Field label="Exam id" error={examError} className="pt-field--grow">
                <input className="pt-input pt-input--mono" value={examId} onChange={(e) => (setExamId(e.target.value), setResult(null))} placeholder="0x8c41f2…" spellCheck={false} autoComplete="off" />
              </Field>
              <Field label="Centre" className="pt-field--centre">
                <select className="pt-input" value={centreId} onChange={(e) => (setCentreId(e.target.value), setResult(null))} disabled={!exam}>
                  {!exam && <option value="">{EXAM_ID_RE.test(examId.trim()) ? 'Loading…' : 'Enter an exam id'}</option>}
                  {exam?.centres.map((c) => (
                    <option key={c.centreId} value={c.centreId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div
              className={`pt-drop${dragging ? ' pt-drop--over' : ''}`}
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Field label="Paper text" error={textError} className="pt-field--flex">
                <textarea className="pt-input pt-paperinput" rows={10} value={text} onChange={(e) => (setText(e.target.value), setTextError(null), setResult(null))} spellCheck={false} placeholder={'# Title\n## Section A\nQ1: …\n- [ ] option'} />
              </Field>
              <div className="pt-row">
                <Button size="sm" icon={<IconUpload size={18} stroke={2} aria-hidden />} onClick={() => fileInput.current?.click()}>
                  Choose a file
                </Button>
                <span className="pt-muted pt-small">or drop a .md or .txt file here</span>
                <input ref={fileInput} type="file" accept=".md,.txt,text/plain,text/markdown" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
              </div>
            </div>
            <Button type="submit" variant="primary" busy={busy} busyLabel={`Checking… ${s} s`} className="pt-selfstart">
              Check this paper
            </Button>
            <p className="pt-muted pt-small">The check uses the exact bytes. A single changed character, space or line break gives a completely different hash.</p>
          </form>

          <div className="pt-col" style={{ gap: 16 }} aria-live="polite">
            {checkError && <Banner tone="error">{checkError.message}</Banner>}
            {!result && !checkError && (
              <div className="pt-placeholder">
                <p className="pt-muted">The result appears here: your hash, the API's commitment and the value read from the contract, side by side.</p>
              </div>
            )}
            {result && (
              <>
                {ok ? (
                  <Verdict tone="ok" title="Matches the on-chain commitment" big={false}>
                    <p>This is {result.centreName}'s copy, exactly as it was set.</p>
                  </Verdict>
                ) : result.chain.error && result.api.error ? (
                  <Banner tone="error">Couldn't read the commitment from the API or the contract. Try again in a minute.</Banner>
                ) : (
                  <Verdict tone="bad" title="Doesn't match — don't use this paper" big={false}>
                    <p>This paper doesn't match what was set. Report it to the exam board.</p>
                  </Verdict>
                )}
                <div className="pt-cardx pt-sources">
                  <div className="pt-source">
                    <div>
                      <strong>Your text, hashed here</strong>
                      <p className="pt-muted pt-small">SHA3-256 of {result.bytes.toLocaleString('en-GB')} bytes</p>
                    </div>
                    <HashLink value={result.hash} kind="plain" small />
                  </div>
                  <XRow yes={!!matchApi} aside={result.api.value ? <HashLink value={result.api.value} kind="plain" small copy={false} /> : <span className="pt-code">{result.api.error}</span>}>
                    Paper Trail API{result.api.value && !matchApi ? ' — different' : ''}
                  </XRow>
                  <XRow yes={!!matchChain} aside={result.chain.value ? <HashLink value={result.chain.value} kind="plain" small copy={false} /> : <span className="pt-code">unavailable</span>}>
                    Read from the contract{result.chain.value && !matchChain ? ' — different' : ''}
                    <span className="pt-source__sub">
                      commitment(examId, centreId) on {shortHash(CONTRACT)}
                    </span>
                  </XRow>
                </div>
                {sourcesDisagree && (
                  <Banner tone="error">The API and the contract disagree about this centre's commitment. Trust the contract's value, and report the difference to the exam board.</Banner>
                )}
                {!ok && result.newlineHint && (
                  <Note>
                    It would match if the final line break were {result.newlineHint === 'add' ? 'added' : 'removed'}: copying often {result.newlineHint === 'add' ? 'drops' : 'adds'} it. The check stays exact, so fix the text and check again.
                  </Note>
                )}
                {!ok && !result.newlineHint && (result.chain.value || result.api.value) && (
                  <Note>
                    Hashed here <span className="pt-mono">{shortHash(result.hash)}</span>, on-chain <span className="pt-mono">{shortHash(result.chain.value ?? result.api.value ?? '')}</span>. If you expected a match, check you picked the right centre and that the text wasn't reformatted when copied.
                  </Note>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </AppPage>
  );
}
