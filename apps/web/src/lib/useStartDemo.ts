import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from './api';
import { writeDemoCache } from './demoCache';
import { setRecentDemo } from './recent';
import type { DemoStart } from './types';

/**
 * Client timeout for POST /demo/start: just under the API function's 300 s maxDuration. A start
 * normally takes 25–40 s (six sequential testnet txs); reopening the EVM window can add ~60 s.
 */
export const START_TIMEOUT_MS = 280_000;

/** What the server is most likely doing after `s` seconds (the API doesn't stream progress). */
export function startStage(s: number): { label: string; step: number } {
  if (s < 5) return { label: 'Preparing the two canary copies…', step: 1 };
  if (s < 13) return { label: 'Creating the exam on QoreChain…', step: 2 };
  if (s < 21) return { label: "Sealing Centre A's and Centre B's copies…", step: 3 };
  if (s < 36) return { label: 'Setting up the invigilator and marker groups…', step: 4 };
  if (s < 60) return { label: 'Waiting for the last confirmations…', step: 4 };
  return { label: 'QoreChain is slower than usual. Still working…', step: 4 };
}
export const START_STEPS = 4;

/** POST /demo/start, then go to /demo/:demoId. Never double-fires. */
export function useStartDemo() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);
  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // A JSON body makes this a preflighted request: from an origin the API doesn't allow, the
      // browser stops it before it reaches the server, instead of the server running the whole
      // setup (and spending a rate-limit slot) only for the response to be blocked.
      const d = await api<DemoStart>('/demo/start', { method: 'POST', body: {}, timeoutMs: START_TIMEOUT_MS });
      writeDemoCache(d.demoId, { start: d });
      setRecentDemo({ demoId: d.demoId, examId: d.examId });
      navigate(`/demo/${d.demoId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  }, [navigate]);
  return { start, busy, error };
}
