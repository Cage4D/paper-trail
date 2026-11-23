// The last demo this tab started (sessionStorage, not secret): lets the landing page offer
// "Open the last demo" when /demo/start is rate-limited, and powers the Demo / Audit nav links.
export interface RecentDemo {
  demoId: string;
  examId: string;
}
const KEY = 'pt-last-demo';

export function getRecentDemo(): RecentDemo | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return v && typeof v.demoId === 'string' && typeof v.examId === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function setRecentDemo(d: RecentDemo) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/** sessionStorage key judge mode uses to hand a decrypted demo paper to the verify page. */
export const VERIFY_DRAFT_KEY = 'pt-verify-text';
