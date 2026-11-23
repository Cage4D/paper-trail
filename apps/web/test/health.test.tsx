import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { HealthChip } from '../src/components/HealthChip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HealthChip', () => {
  it('fetches /health once for several chips, not once per render', async () => {
    const health = { ok: true, warnings: [], contract: '0x', db: { ok: true }, rpc: { ok: true, value: '1' }, relayerBalanceQor: { ok: true, value: '5' }, window: { ok: true }, indexerLagBlocks: { ok: true, value: '0' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(health), { status: 200 }));
    render(
      <>
        <HealthChip />
        <HealthChip long />
      </>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
