import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from './api';
import { writeDemoCache } from './demoCache';
import { setRecentDemo } from './recent';
import type { DemoStart } from './types';

/** POST /demo/start (15–40 s, 5 per hour per IP), then go to /demo/:demoId. Never double-fires. */
export function useStartDemo() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<DemoStart>('/demo/start', { method: 'POST', timeoutMs: 150_000 });
      writeDemoCache(d.demoId, { start: d });
      setRecentDemo({ demoId: d.demoId, examId: d.examId });
      navigate(`/demo/${d.demoId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('INTERNAL', 'Something went wrong on our side. Try again.'));
      setBusy(false);
    }
  }, [busy, navigate]);
  return { start, busy, error };
}
