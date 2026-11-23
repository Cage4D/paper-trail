// Judge mode state, derived from GET /demo/:id `steps` (the server's log of beats done so far),
// the exam view, and this tab's cached action responses. Reloading at any point re-derives the
// same state; buttons are enabled only from this, never from local "I clicked it" flags alone.
import type { DemoCache } from './demoCache';
import type { DemoRole, DemoState, DemoStep, LeakResult, OpenResult } from './types';

/** Title of core's SAMPLE_PAPER, the judge-mode paper (kept equal by test/demoState.test.ts; importing core here would pull the whole crypto bundle into the page). */
export const DEMO_PAPER_TITLE = 'Paper Trail Demo Board — General Science Mock (Year 11)';

export type BeatState = 'pending' | 'running' | 'done' | 'refused';

export const ROLE_NAME: Record<DemoRole, string> = {
  board: 'Exam board',
  examiner1: 'Examiner 1 (bot)',
  examiner2: 'Examiner 2',
  examiner3: 'Examiner 3',
  invigilatorA1: 'Invigilator A1',
  invigilatorA2: 'Invigilator A2',
  invigilatorB1: 'Invigilator B1',
  marker1: 'Marker 1',
  marker2: 'Marker 2',
};

/** Roles the judge can play (the switcher). Everyone else is a bot. */
export const PLAYABLE: DemoRole[] = ['examiner2', 'examiner3', 'board', 'invigilatorA1', 'invigilatorA2'];

export const roleLabel = (r: DemoRole, you: DemoRole) => `${ROLE_NAME[r]}${r === you ? ' (you)' : ''}`;

export interface LaterDoc {
  what: string;
  result: string;
}

/** The six background setup txs, in order, with plain labels (API steps "set:<part>"). */
export const SETUP_PARTS: { part: string; label: string }[] = [
  { part: 'createExam', label: 'Exam created' },
  { part: 'centreA', label: "Centre A's locked copy recorded" },
  { part: 'centreB', label: "Centre B's locked copy recorded" },
  { part: 'groupA', label: "Centre A's team set up" },
  { part: 'groupB', label: "Centre B's team set up" },
  { part: 'markers', label: "The markers' team set up" },
];

export interface Derived {
  set?: DemoStep;
  /** setup failed in the background ("set" ok:false) */
  setFailed?: DemoStep;
  /** landed setup txs by part ("set:<part>" steps) */
  setParts: Record<string, DemoStep>;
  early?: DemoStep; // latest beat-2 refusal
  earlyMessage?: string;
  bot?: DemoStep; // examiner 1's successful release
  judge?: DemoStep; // examiner 2/3's successful release
  judgeRole?: DemoRole;
  releasedA: boolean;
  releaseCountA: number;
  epochA: number;
  openA1?: DemoStep;
  remove?: DemoStep;
  scripts?: DemoStep;
  openA2?: DemoStep;
  a2Paper?: { opened: boolean; code?: string };
  a2Later: LaterDoc[];
  leaks: DemoStep[];
  states: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, BeatState>;
  /** The beat the judge is on (1–7), for "beat N of 7". */
  current: number;
  doneCount: number;
}

const releaseRole = (s: DemoStep) => s.name.match(/^release by (examiner[123])$/)?.[1] as DemoRole | undefined;

/** "Authentic ✓ (…); later documents: centre A group key, epoch 2 → NOT_A_MEMBER, a candidate script → NOT_A_RECIPIENT" */
export function parseOpenSummary(summary: string): { opened: boolean; code?: string; later: LaterDoc[] } {
  const [head, tail] = summary.split('; later documents: ');
  const opened = head.startsWith('Authentic');
  const code = opened ? undefined : head.replace(/^cannot open:\s*/, '').trim();
  const later: LaterDoc[] = [];
  if (tail) for (const m of tail.matchAll(/(.+?) → (\S+?)(?:, |$)/g)) later.push({ what: m[1].trim(), result: m[2] });
  return { opened, code, later };
}

/** "excerpt of centre B's copy → Centre B (confidence 0.98, 23/23 bits)" */
export function parseLeakSummary(summary: string): LeakResult['result'] | null {
  const m = summary.match(/→ (.+?) \(confidence ([\d.]+), (\d+)\/(\d+) bits\)/);
  if (!m) return null;
  return { copy: m[1] === 'no attribution' ? null : m[1], confidence: Number(m[2]), matchedBits: Number(m[3]), observedBits: Number(m[4]), distanceToRunnerUp: NaN };
}

export function derive(state: DemoState, cache: DemoCache, live: boolean): Derived {
  const steps = state.steps ?? [];
  const find = (pred: (s: DemoStep) => boolean) => steps.find(pred);
  const set = find((s) => s.name === 'set' && s.ok);
  const setFailed = set ? undefined : find((s) => s.name === 'set' && !s.ok);
  const setParts = Object.fromEntries(steps.filter((s) => s.name.startsWith('set:') && s.ok).map((s) => [s.name.slice(4), s]));
  const earlies = steps.filter((s) => s.beat === 2 && !s.ok && releaseRole(s));
  const early = earlies[earlies.length - 1];
  const okReleases = steps.filter((s) => s.ok && s.beat === 3 && releaseRole(s));
  const bot = okReleases.find((s) => releaseRole(s) === 'examiner1');
  const judge = okReleases.find((s) => releaseRole(s) !== 'examiner1');
  const centreA = state.exam?.centres?.find((c) => c.centreId.toLowerCase() === state.centres.A.toLowerCase());
  const releasedA = !!centreA?.released || okReleases.some((s) => s.summary.includes('Released')) || okReleases.length >= 2;
  const releaseCountA = Math.max(centreA?.releaseCount ?? 0, okReleases.length);
  const openA1 = find((s) => s.name === 'invigilatorA1 opens centre A' && s.ok);
  const remove = find((s) => s.name === 'board removes invigilatorA2');
  const scripts = find((s) => /candidate bots submit scripts$/.test(s.name));
  const a2Steps = steps.filter((s) => s.name === 'invigilatorA2 opens centre A');
  const openA2 = remove ? a2Steps.filter((s) => new Date(s.at) >= new Date(remove.at)).pop() : undefined;
  const leaks = steps.filter((s) => s.name === 'leak traced');

  let a2Paper: Derived['a2Paper'];
  let a2Later: LaterDoc[] = [];
  const cachedA2: OpenResult | undefined = cache.openA2;
  if (cachedA2) {
    a2Paper = { opened: cachedA2.opened, code: cachedA2.error };
    a2Later = cachedA2.laterDocuments ?? [];
  } else if (openA2) {
    const p = parseOpenSummary(openA2.summary);
    a2Paper = { opened: p.opened, code: p.code };
    a2Later = p.later;
  }

  const states: Derived['states'] = { 1: set ? 'done' : setFailed ? 'refused' : 'running', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending' };
  // nothing can be acted on until the exam, centres and teams are on the blockchain
  states[2] = early ? 'refused' : live || !set ? 'pending' : 'running';
  if (live && set) states[3] = releasedA && judge ? 'done' : 'running';
  if (states[3] === 'done') states[4] = openA1 ? 'done' : 'running';
  if (states[4] === 'done') states[5] = openA2 && scripts ? 'done' : 'running';
  if (states[5] === 'done') states[6] = leaks.length ? 'done' : 'running';
  if (states[6] === 'done') states[7] = 'running';
  const order = [1, 2, 3, 4, 5, 6, 7] as const;
  // while sealed after the refusal nothing is running: the judge is still on beat 2 (reading the diff)
  const current = order.find((n) => states[n] === 'running') ?? (!set ? 1 : live ? 7 : 2);
  const doneCount = order.filter((n) => states[n] === 'done' || states[n] === 'refused').length;
  return {
    set,
    setFailed,
    setParts,
    early,
    earlyMessage: early?.summary.replace(/^TOO_EARLY:\s*/, ''),
    bot,
    judge,
    judgeRole: judge ? releaseRole(judge) : undefined,
    releasedA,
    releaseCountA,
    epochA: centreA?.epoch ?? 1,
    openA1,
    remove,
    scripts,
    openA2,
    a2Paper,
    a2Later,
    leaks,
    states,
    current,
    doneCount,
  };
}
