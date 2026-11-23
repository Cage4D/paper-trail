import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { HashLink } from '../components/HashLink';
import { AppPage } from '../components/Shell';
import { OnChainDetails, Verdict, XRow } from '../components/Verdict';
import { ApiError, api } from '../lib/api';
import { loadCore } from '../lib/crypto';
import { shortHash } from '../lib/format';
import { useElapsed } from '../lib/hooks';
import type { AuditView, Hex, MarksProof } from '../lib/types';
import { EXAM_ID_RE } from './Audit';

interface Checked {
  proof: MarksProof;
  leaf: Hex;
  valid: boolean;
  /** merkleRoot of the MarksPublished event in the exam's on-chain audit trail. */
  eventRoot: Hex | null;
  eventTx: Hex | null;
}

export function Marks() {
  const [params] = useSearchParams();
  const [examId, setExamId] = useState(params.get('exam') ?? '');
  const [pseudonym, setPseudonym] = useState('');
  const [examErr, setExamErr] = useState<string | null>(null);
  const [psErr, setPsErr] = useState<string | null>(null);
  const [wait, setWait] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Checked | null>(null);
  const s = useElapsed(busy);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const id = examId.trim().toLowerCase();
    const ps = pseudonym.trim();
    let bad = false;
    if (!EXAM_ID_RE.test(id)) (setExamErr('Enter an exam id: 0x followed by 64 hex characters.'), (bad = true));
    if (!/^ps_[A-Za-z0-9_-]+$/.test(ps)) (setPsErr("That isn't a code name. It's on your exam ticket and starts with ps_."), (bad = true));
    if (bad) return;
    setBusy(true);
    setRes(null);
    setWait(null);
    setError(null);
    try {
      const [proofRes, audit] = await Promise.allSettled([
        api<MarksProof>(`/exams/${id}/marks/proof?pseudonym=${encodeURIComponent(ps)}`, { timeoutMs: 60_000 }),
        api<AuditView>(`/exams/${id}/audit`, { timeoutMs: 60_000 }),
      ]);
      const published = audit.status === 'fulfilled' ? audit.value.timeline.filter((x) => x.name === 'MarksPublished').pop() : undefined;
      if (proofRes.status === 'rejected') {
        const err = proofRes.reason instanceof ApiError ? proofRes.reason : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.');
        if (err.code === 'NOT_FOUND' && audit.status === 'rejected') setExamErr("That doesn't exist. Check the exam id.");
        else if (err.code === 'NOT_FOUND' && !published && audit.status === 'fulfilled' && !audit.value.check.marksRoot) setWait("Marks for this exam haven't been published yet.");
        else if (err.code === 'NOT_FOUND') setPsErr(`${err.message} Check the code name on your ticket.`);
        else setError(err);
        return;
      }
      const proof = proofRes.value;
      const { verifyMarkProof, markLeaf, toHex } = await loadCore();
      const entry = { pseudonymHash: proof.pseudonymHash, score: proof.score };
      setRes({
        proof,
        leaf: toHex(markLeaf(entry)) as Hex,
        valid: verifyMarkProof(proof.merkleRoot, entry, proof.proof),
        eventRoot: (published?.data.merkleRoot as Hex | undefined) ?? null,
        eventTx: published?.txHash ?? null,
      });
    } finally {
      setBusy(false);
    }
  };

  const sameRoot = !!res?.eventRoot && res.eventRoot.toLowerCase() === res.proof.merkleRoot.toLowerCase();
  const proven = !!res && res.valid && sameRoot;

  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" style={{ gap: 28 }}>
        <div className="pt-col" style={{ gap: 12 }}>
          <h1 className="pt-h1 pt-h1--xl">Check my mark</h1>
          <p className="pt-lead">Markers only ever see the code name on your exam ticket, never your name. The exam board publishes everyone's marks as one short code on the blockchain, so you can prove your own mark without taking anyone's word for it.</p>
        </div>
        <div className="pt-two pt-two--marks">
          <form className="pt-col" style={{ gap: 20 }} onSubmit={submit} noValidate>
            <Field label="Exam id" error={examErr} className="pt-field--flex">
              <input className="pt-input pt-input--mono" value={examId} onChange={(e) => (setExamId(e.target.value), setExamErr(null))} placeholder="0x8c41f2…" spellCheck={false} autoComplete="off" />
            </Field>
            <Field label="Your code name" error={psErr} help="It's on your exam ticket and starts with ps_." className="pt-field--flex">
              <input className="pt-input pt-input--mono pt-input--big" value={pseudonym} onChange={(e) => (setPseudonym(e.target.value), setPsErr(null))} placeholder="ps_k4w9-mt2q-87hd" spellCheck={false} autoComplete="off" />
            </Field>
            <Button type="submit" variant="primary" busy={busy} busyLabel={`Checking… ${s} s`} className="pt-selfstart">
              Check my mark
            </Button>
            {wait && <Banner tone="wait">{wait}</Banner>}
            {error && <Banner tone="error">{error.message}</Banner>}
          </form>

          <div className="pt-col" style={{ gap: 16 }} aria-live="polite">
            {!res && (
              <div className="pt-placeholder">
                <p className="pt-muted">Your mark appears here once it's been checked against the marks code on the blockchain. The check runs in this browser.</p>
              </div>
            )}
            {res && (
              <>
                <div className="pt-cardx pt-score">
                  <div className="pt-score__disc" aria-label={`Your mark: ${res.proof.score}`}>
                    <span className="pt-score__n">{res.proof.score}</span>
                    <span className="pt-score__l">your mark</span>
                  </div>
                  <div className="pt-col" style={{ gap: 8 }}>
                    {proven ? <Chip status="done">Proven</Chip> : <Chip status="failed">Not proven</Chip>}
                    <p className="pt-score__title">{proven ? 'Proven: this is the mark the board published' : res.valid ? "The proof works, but not against the marks code on the blockchain" : "This proof doesn't lead to the published marks code"}</p>
                    {(res.proof.publishTx ?? res.eventTx) && <HashLink value={(res.proof.publishTx ?? res.eventTx)!} label="published in" small />}
                  </div>
                </div>
                {!proven && (
                  <Verdict tone="bad" title="Don't rely on this mark" big={false}>
                    <p>Report it to the exam board with your code name.</p>
                  </Verdict>
                )}
                <div className="pt-cardx">
                  <h2 className="pt-h3">How it was checked, in your browser</h2>
                  <div className="pt-xrows">
                    <XRow yes>
                      Combined your code name and mark into a code <span className="pt-mono pt-mono--inline">{shortHash(res.leaf)}</span>
                    </XRow>
                    <XRow yes={res.valid}>
                      Followed {res.proof.proof.length} checking step{res.proof.proof.length === 1 ? '' : 's'} up to the marks code <span className="pt-mono pt-mono--inline">{shortHash(res.proof.merkleRoot)}</span>
                    </XRow>
                    <XRow yes={sameRoot}>
                      {res.eventRoot ? (sameRoot ? 'It matches the marks code the board published on the ' : "It doesn't match the marks code the board published on the ") : 'No published marks code found yet on the '}
                      <Link to={`/exams/${examId.trim().toLowerCase()}/audit`}>audit trail</Link>
                    </XRow>
                  </div>
                  <OnChainDetails
                    summary="Show the proof"
                    rows={[
                      ['Pseudonym hash', res.proof.pseudonymHash],
                      ['Score', String(res.proof.score)],
                      ...res.proof.proof.map((p, i): [string, string] => [`Step ${i + 1}`, p]),
                      ['Root', res.proof.merkleRoot],
                    ]}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </AppPage>
  );
}
