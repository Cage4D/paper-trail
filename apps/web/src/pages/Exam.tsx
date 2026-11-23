import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import envelope from '../assets/stickers/sealed-envelope.svg';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Countdown } from '../components/Countdown';
import { HashLink } from '../components/HashLink';
import { ReleaseMeter } from '../components/ReleaseMeter';
import { AppPage } from '../components/Shell';
import { ApiError, api } from '../lib/api';
import { errorMessage } from '@paper-trail/shared';
import { usePoll } from '../lib/hooks';
import type { ExamView } from '../lib/types';
import { EXAM_ID_RE } from './Audit';

export function Exam() {
  const { examId = '' } = useParams();
  const [exam, setExam] = useState<ExamView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    try {
      setExam(await api<ExamView>(`/exams/${examId}`, { timeoutMs: 60_000 }));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));
    }
  }, [examId]);
  usePoll(load, 5000, EXAM_ID_RE.test(examId) && error?.code !== 'NOT_FOUND');

  if (!EXAM_ID_RE.test(examId) || (error && !exam))
    return (
      <AppPage>
        <section className="pt-wrap pt-section pt-empty">
          <img src={envelope} alt="" aria-hidden="true" className="pt-empty__art" />
          <h1 className="pt-h1">{error?.code === 'NOT_FOUND' || !EXAM_ID_RE.test(examId) ? 'No exam with this id' : "Can't load this exam"}</h1>
          <Banner tone="error" action={error?.retryable ? <Button size="sm" onClick={() => void load()}>Try again</Button> : undefined}>
            {!EXAM_ID_RE.test(examId) ? "That isn't an exam id. It should be 0x followed by 64 hex characters." : error!.message}
          </Banner>
          <Link className="pt-btn" to="/audit">
            Enter an exam id
          </Link>
        </section>
      </AppPage>
    );

  if (!exam)
    return (
      <AppPage>
        <section className="pt-wrap pt-section pt-col" aria-busy="true" aria-label="Loading the exam">
          <div className="pt-skel pt-skel--line" style={{ width: 180 }} />
          <div className="pt-skel pt-skel--title" />
          <div className="pt-skel" style={{ height: 160 }} />
        </section>
      </AppPage>
    );

  const releasedCount = exam.centres.filter((c) => c.released).length;
  const waiting = exam.centres.filter((c) => !c.released && c.releaseCount === 1);
  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 32 }}>
        <div className="pt-examhead">
          <div className="pt-col" style={{ gap: 14, flex: '1 1 480px', minWidth: 0 }}>
            <div className="pt-row" style={{ gap: 8 }}>
              <span className="pt-eyebrow">Exam</span>
              {exam.status === 'CREATED' ? <Chip status="done" icon={null}>Created</Chip> : exam.status === 'FAILED' ? <Chip status="failed">Failed</Chip> : <Chip status="pending" icon={null}>Pending</Chip>}
              <Chip status={releasedCount === exam.centres.length && releasedCount ? 'released' : releasedCount ? 'pending' : 'sealed'} icon={null}>
                {releasedCount} of {exam.centres.length} centres unlocked
              </Chip>
            </div>
            <h1 className="pt-h1 pt-h1--xl">{exam.title}</h1>
            <dl className="pt-kv pt-kv--exam">
              <dt>Exam id</dt>
              <dd>
                <HashLink value={exam.examId} kind="plain" />
              </dd>
              <dt>Board</dt>
              <dd>
                <HashLink value={exam.board} kind="address" copy={false} />
              </dd>
              <dt>Examiners</dt>
              <dd className="pt-row" style={{ gap: '6px 14px' }}>
                {exam.examiners.map((x) => (
                  <HashLink key={x} value={x} kind="address" copy={false} />
                ))}
              </dd>
              <dt>Master copy code</dt>
              <dd>
                <HashLink value={exam.masterCommitment} kind="plain" copy={false} />
              </dd>
              {exam.createTx && (
                <>
                  <dt>Created in</dt>
                  <dd>
                    <HashLink value={exam.createTx} copy={false} />
                  </dd>
                </>
              )}
            </dl>
          </div>
          <div className="pt-col pt-examhead__side">
            <Countdown startTime={exam.startTime} longDate />
            <Link className="pt-btn pt-btn--full" to={`/exams/${exam.examId}/audit`}>
              View audit trail
            </Link>
          </div>
        </div>

        <div className="pt-col" style={{ gap: 16 }}>
          <div className="pt-row" style={{ justifyContent: 'space-between' }}>
            <h2 className="pt-h2">Centres</h2>
            <span className="pt-muted pt-small">Each centre gets its own locked copy. Updates every 5 s.</span>
          </div>
          <div className="pt-tablebox">
            <table className="pt-table pt-table--centres">
              <thead>
                <tr>
                  <th scope="col">Centre</th>
                  <th scope="col">Paper code</th>
                  <th scope="col">Locked file code</th>
                  <th scope="col">Team version</th>
                  <th scope="col">Keys used</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {exam.centres.map((c) => (
                  <tr key={c.centreId}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="pt-hash__label" title={c.centreId}>
                        {c.centreId.slice(0, 6)}…{c.centreId.slice(-4)}
                      </div>
                    </td>
                    <td>
                      <HashLink value={c.commitment} kind="plain" small copy={false} />
                    </td>
                    <td>
                      <HashLink value={c.cipherHash} kind="plain" small copy={false} />
                    </td>
                    <td>
                      <span className="pt-epochdot" aria-label={`Epoch ${c.epoch}`}>
                        {c.epoch}
                      </span>
                    </td>
                    <td>
                      <ReleaseMeter mini count={c.releaseCount} released={c.released} />
                    </td>
                    <td>
                      {c.released ? <Chip status="done">Unlocked</Chip> : c.releaseCount === 1 ? <Chip status="pending">Waiting for a 2nd key</Chip> : <Chip status="sealed">Locked</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {waiting.map((c) => (
            <Banner key={c.centreId} tone="wait">
              {c.name}: {errorMessage('NOT_RELEASED', { count: 1 })}
            </Banner>
          ))}
        </div>
      </section>
    </AppPage>
  );
}
