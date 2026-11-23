import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Landing } from '../src/pages/Landing';
import { START_TIMEOUT_MS, startStage } from '../src/lib/useStartDemo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('demo start', () => {
  it('moves through the staged progress copy as time passes', () => {
    expect(startStage(0).label).toMatch(/canary copies/);
    expect(startStage(8).label).toMatch(/Creating the exam/);
    expect(startStage(15).label).toMatch(/Sealing Centre A/);
    expect(startStage(30).label).toMatch(/invigilator and marker groups/);
    expect(startStage(90).label).toMatch(/slower than usual/);
  });

  it('waits ~280 s, sends a preflighted JSON POST, and on timeout warns about the hourly limit instead of offering a retry', async () => {
    expect(START_TIMEOUT_MS).toBeGreaterThanOrEqual(270_000);
    expect(START_TIMEOUT_MS).toBeLessThan(300_000);
    vi.useFakeTimers();
    const calls: RequestInit[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).endsWith('/health')) return new Promise(() => {});
      calls.push(init!);
      return new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    });
    render(<MemoryRouter><Landing /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Start the 3-minute demo/ }));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect((calls[0].headers as Record<string, string>)['Content-Type']).toBe('application/json');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1000);
    });
    expect(screen.queryByText(/may still have been created/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/may still have been created/)).toBeTruthy();
    expect(screen.getByText(/5 per hour/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });
});
