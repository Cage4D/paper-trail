// Plain-English meanings of the words the app can't avoid. Used by <Term> and the landing page's
// "Words explained" section. Keep each one short enough to read in a tooltip.
export const GLOSSARY = {
  board: { term: 'Exam board', def: 'The organisation that sets the exam and runs the exam centres.' },
  examiner: { term: 'Examiner', def: 'A senior person who approved the paper. Each of the three holds one key; any two together can open the paper.' },
  centre: { term: 'Exam centre', def: 'A school or hall where candidates sit the exam.' },
  invigilator: { term: 'Invigilator', def: 'Staff at an exam centre who open the paper on the day and supervise the exam.' },
  canary: { term: 'Canary copy', def: 'Each centre gets a slightly different copy (question order, option order, wording). If a copy leaks, those differences show which centre it came from.' },
  hash: { term: 'Hash (a paper’s code)', def: 'A short code worked out from the exact text. Change a single letter and the code changes completely, so it proves a paper hasn’t been altered.' },
  onchain: { term: 'On the blockchain', def: 'Written to QoreChain, a public record that anyone can read and nobody can quietly change.' },
  team: { term: 'Team version', def: 'Each time the board changes who is on a centre’s team, the team gets a new version number. New papers are locked to the current team only. (Technically: the epoch.)' },
  signature: { term: 'Quantum-safe signature', def: 'A digital signature that stays secure even against future quantum computers (ML-DSA-87). Every step here is signed and the blockchain checks it.' },
  pseudonym: { term: 'Code name', def: 'The code on a candidate’s ticket (it starts with ps_). Markers only ever see this, never the candidate’s name.' },
  marksCode: { term: 'Marks code', def: 'One short code that stands for every mark in the exam, published on the blockchain. Each candidate can prove their own mark is part of it. (Technically: a Merkle root.)' },
  testnet: { term: 'Testnet', def: 'A practice version of the blockchain. Everything is real, but nothing costs real money.' },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
