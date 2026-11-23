import { describe, expect, it } from 'vitest';
import { SAMPLE_PAPER } from '@paper-trail/core';
import { DEMO_PAPER_TITLE, derive, parseLeakSummary, parseOpenSummary } from '../src/lib/demoState';
import { parseCopy } from '../src/lib/paper';
import type { DemoState, DemoStep } from '../src/lib/types';

const A = '0x' + 'a'.repeat(64);
const B = '0x' + 'b'.repeat(64);
const step = (beat: number, name: string, ok: boolean, summary = '', at = '2026-11-23T10:00:00Z'): DemoStep => ({ beat, name, ok, summary, at, txs: ok ? [('0x' + '1'.repeat(64)) as `0x${string}`] : [] });
const state = (steps: DemoStep[], released = false): DemoState => ({
  demoId: 'd', examId: ('0x' + 'e'.repeat(64)) as `0x${string}`, startTime: '2026-11-23T10:01:30Z', startsInSeconds: 0, centres: { A, B } as never, steps, audit: '', events: '',
  exam: { centres: [{ centreId: A, name: 'Centre A', released, releaseCount: released ? 2 : 0, epoch: 1 }] } as never,
});

describe('judge mode state', () => {
  it('keeps the fallback title equal to the sample paper', () => {
    expect(parseCopy(SAMPLE_PAPER).title).toBe(DEMO_PAPER_TITLE);
  });
  it('is on beat 2 while sealed, refused once the contract said no', () => {
    const d = derive(state([step(1, 'set', true), step(2, 'release by examiner1', false, 'TOO_EARLY: This paper is still sealed.')]), {}, false);
    expect(d.states).toMatchObject({ 1: 'done', 2: 'refused', 3: 'pending' });
    expect(d.current).toBe(2);
    expect(d.earlyMessage).toBe('This paper is still sealed.');
  });
  it('ignores a TOO_EARLY retry at the countdown edge and waits for the judge after the bot', () => {
    const d = derive(state([step(1, 'set', true), step(3, 'release by examiner1', false, 'TOO_EARLY: x'), step(3, 'release by examiner1', true, 'centre A: 1 of 2')]), {}, true);
    expect(d.bot).toBeDefined();
    expect(d.judge).toBeUndefined();
    expect(d.states[3]).toBe('running');
  });
  it('walks the beats to the end from the step log alone (reload in a fresh tab)', () => {
    const steps = [
      step(1, 'set', true),
      step(2, 'release by examiner1', false, 'TOO_EARLY: x'),
      step(3, 'release by examiner1', true, 'centre A: 1 of 2'),
      step(3, 'release by examiner2', true, 'centre A: 2 of 2 → Released'),
      step(4, 'invigilatorA1 opens centre A', true, 'Authentic ✓ (matches the on-chain commitment)', '2026-11-23T10:02:00Z'),
      step(5, 'board removes invigilatorA2', true, 'centre group → epoch 2 (1 member)', '2026-11-23T10:03:00Z'),
      step(5, '6 candidate bots submit scripts', true, 'sealed', '2026-11-23T10:04:00Z'),
      step(5, 'invigilatorA2 opens centre A', true, 'Authentic ✓ (x); later documents: centre A group key, epoch 2 → NOT_A_MEMBER, a candidate script → NOT_A_RECIPIENT', '2026-11-23T10:05:00Z'),
      step(6, 'leak traced', true, "excerpt of centre B's copy → Centre B (confidence 0.98, 23/23 bits)", '2026-11-23T10:06:00Z'),
    ];
    const d = derive(state(steps, true), {}, true);
    expect(d.states).toEqual({ 1: 'done', 2: 'refused', 3: 'done', 4: 'done', 5: 'done', 6: 'done', 7: 'running' });
    expect(d.judgeRole).toBe('examiner2');
    expect(d.a2Paper).toEqual({ opened: true, code: undefined });
    expect(d.a2Later).toEqual([
      { what: 'centre A group key, epoch 2', result: 'NOT_A_MEMBER' },
      { what: 'a candidate script', result: 'NOT_A_RECIPIENT' },
    ]);
    expect(d.doneCount).toBe(6);
  });
  it('parses open and leak summaries, including no attribution', () => {
    expect(parseOpenSummary('cannot open: NOT_A_MEMBER')).toEqual({ opened: false, code: 'NOT_A_MEMBER', later: [] });
    expect(parseLeakSummary('excerpt of centre B\'s copy → no attribution (confidence 0.40, 10/23 bits)')).toMatchObject({ copy: null, matchedBits: 10, observedBits: 23 });
  });

  it('shows the background setup landing tx by tx, and keeps beat 2 shut until it is done', () => {
    const parts = [step(1, 'set:createExam', true), step(1, 'set:centreA', true)];
    const d = derive(state(parts), {}, false);
    expect(d.states[1]).toBe('running');
    expect(Object.keys(d.setParts)).toEqual(['createExam', 'centreA']);
    expect(d.states[2]).toBe('pending');
    expect(d.current).toBe(1);
    const done = derive(state([...parts, step(1, 'set', true)]), {}, false);
    expect(done.states).toMatchObject({ 1: 'done', 2: 'running' });
  });
  it('marks a failed setup and never treats progress steps as done', () => {
    const d = derive(state([step(1, 'set:createExam', true), step(1, 'set', false, 'CHAIN_UNAVAILABLE: x')]), {}, true);
    expect(d.states[1]).toBe('refused');
    expect(d.setFailed).toBeDefined();
    expect(d.states[3]).toBe('pending');
  });
  it('copes with exam: null while createExam is still landing', () => {
    const s = { ...state([]), exam: null };
    expect(derive(s, {}, false).releasedA).toBe(false);
  });
});
