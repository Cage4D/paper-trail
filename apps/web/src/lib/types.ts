// Response shapes of the Paper Trail API (handoff §5.2, §5.3), checked against apps/api/src.
export type Hex = `0x${string}`;
export type CentreKey = 'A' | 'B';

export type DemoRole =
  | 'board'
  | 'examiner1'
  | 'examiner2'
  | 'examiner3'
  | 'invigilatorA1'
  | 'invigilatorA2'
  | 'invigilatorB1'
  | 'marker1'
  | 'marker2';

export interface CentreView {
  centreId: Hex;
  name: string;
  commitment: Hex;
  cipherHash: Hex;
  confirmed: boolean;
  epoch: number;
  released: boolean;
  releaseCount: number;
  setTx: Hex | null;
}

export interface ExamView {
  examId: Hex;
  title: string;
  status: 'PENDING' | 'CREATED' | 'FAILED';
  board: Hex;
  examiners: [Hex, Hex, Hex];
  startTime: string;
  masterCommitment: Hex;
  committeeBundleHash: Hex;
  createTx: Hex | null;
  centres: CentreView[];
}

export interface QuestionDiff {
  section: number;
  canonical: number;
  positionA: number;
  positionB: number;
  optionOrderA: number[];
  optionOrderB: number[];
}

export interface DemoVariants {
  master: string;
  A: string;
  B: string;
  commitments: { master: Hex; A: Hex; B: Hex };
  minPairDistanceBits: number;
  differences: { questions: QuestionDiff[]; togglesDiffer: number; toggles: number };
}

export interface DemoStart {
  demoId: string;
  examId: Hex;
  startTime: string;
  startsInSeconds: number;
  centres: { A: Hex; B: Hex };
  roles: Record<DemoRole, { label: string; address: Hex; roleAddress: string }>;
  roleLinks: Record<DemoRole, string>;
  txs: { tx: Hex; explorer: string }[];
  variants: DemoVariants;
  label: string;
}

export interface DemoStep {
  beat: number;
  name: string;
  at: string;
  ok: boolean;
  summary: string;
  txs: Hex[];
}

export interface DemoState {
  demoId: string;
  examId: Hex;
  startTime: string;
  startsInSeconds: number;
  centres: { A: Hex; B: Hex };
  steps: DemoStep[];
  exam: ExamView;
  audit: string;
  events: string;
}

export interface ReleaseRefused {
  beat: 2;
  ok: false;
  refusedByContract: true;
  error: { code: 'TOO_EARLY'; message: string };
  note: string;
}
export interface ReleaseDone {
  beat: 3;
  ok: true;
  centre: CentreKey;
  count: number;
  released: boolean;
  txHash: Hex;
  explorer: string;
}
export type ReleaseResult = ReleaseRefused | ReleaseDone;

export interface OpenResult {
  beat: 4;
  as: DemoRole;
  centre: CentreKey;
  opened: boolean;
  authentic?: true;
  commitment?: Hex;
  paper?: string;
  error?: string;
  laterDocuments?: { what: string; result: string }[];
}

export interface RemoveResult {
  beat: 5;
  ok: true;
  removed: DemoRole;
  epoch: number;
  members: string[];
  txHash: Hex;
  explorer: string;
}

export interface ScriptsResult {
  beat: 5;
  ok: true;
  submitted: { scriptId: string; txHash: Hex; explorer: string }[];
  sealedTo: string[];
}

export interface LeakResult {
  beat: 6;
  leakedExcerpt: string;
  result: { copy: string | null; confidence: number; matchedBits: number; observedBits: number; distanceToRunnerUp: number };
  centre: null | {
    centreId: Hex;
    name: string;
    commitment: Hex;
    setTx: Hex | null;
    setExplorer: string | null;
    epoch?: number;
    recipients?: { address: string; roleAddress: string }[];
    epochTx?: Hex | null;
    epochExplorer?: string | null;
  };
  note: string;
}

export interface AuditEvent {
  name: string;
  block: string;
  logIndex: number;
  cursor: string;
  centreId: Hex | null;
  data: Record<string, unknown>;
  txHash: Hex;
  explorer: string;
}

export interface AuditView {
  examId: Hex;
  contract: Hex;
  chainId: number;
  timeline: AuditEvent[];
  check: {
    how: string;
    masterCommitment: Hex;
    centres: { centreId: Hex; name: string; commitment: Hex; cipherHash: Hex }[];
    marksRoot: Hex | null;
  };
}

export interface EventsPage {
  events: AuditEvent[];
  cursor: string | null;
  pollAfterMs: number;
}

export interface MarksProof {
  pseudonymHash: Hex;
  score: number;
  proof: string[];
  merkleRoot: Hex;
  publishTx: Hex | null;
}

type Check<T> = { ok: boolean; value?: T; error?: string };
export interface Health {
  ok: boolean;
  warnings: string[];
  contract: Hex;
  db: Check<boolean>;
  rpc: Check<string>;
  relayerBalanceQor: Check<string>;
  window: Check<unknown>;
  indexerLagBlocks: Check<string>;
}
