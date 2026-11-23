import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { createQorexMock } from '@qorechain/qorex-wallet-mock';
import { QorexConnect } from '../src/components/QorexConnect';

afterEach(() => {
  cleanup();
  delete (window as { qorex?: unknown }).qorex;
});

const ui = () => render(<MemoryRouter><QorexConnect /></MemoryRouter>);

describe('Connect QoreX', () => {
  it('shows the qor1 address QoreX shares (read-only: enable + getKey, no signing)', async () => {
    const mock = createQorexMock({ profile: 'current' }).install(window);
    ui();
    fireEvent.click(screen.getByRole('button', { name: /connect qorex/i }));
    const native = mock.addresses().native;
    await waitFor(() => expect(screen.getByTitle(new RegExp(native))).toBeTruthy());
    const methods = mock.requests.map((r) => r.method);
    expect(methods.some((m) => /sign/i.test(m))).toBe(false);
  });

  it('says the demo works without it when QoreX is missing', async () => {
    ui();
    fireEvent.click(screen.getByRole('button', { name: /connect qorex/i }));
    await waitFor(() => expect(screen.getByText(/isn’t installed/)).toBeTruthy());
  });

  it('handles a refusal', async () => {
    const mock = createQorexMock({ profile: 'current', autoApprove: false }).install(window);
    ui();
    fireEvent.click(screen.getByRole('button', { name: /connect qorex/i }));
    await waitFor(() => expect(mock.pendingApprovals).toBeGreaterThan(0));
    mock.rejectNext();
    await waitFor(() => expect(screen.getByText(/didn’t share an address/)).toBeTruthy());
  });
});
