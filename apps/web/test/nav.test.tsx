import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppBar } from '../src/components/Shell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const linksOn = (path: string) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
  render(<MemoryRouter initialEntries={[path]}><AppBar /></MemoryRouter>);
  const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
  const links = within(nav).getAllByRole('link').map((a) => `${a.textContent}→${a.getAttribute('href')}`);
  const current = within(nav).queryAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent);
  cleanup();
  return { links, current };
};

describe('global nav', () => {
  it('shows the same links in the same order on every page, with no start-demo button; only the highlight moves', () => {
    const pages = ['/', '/demo', '/demo/abc', '/audit', '/exams/0xabc/audit', '/verify', '/marks'];
    const seen = pages.map(linksOn);
    for (const s of seen) expect(s.links).toEqual(seen[0].links);
    expect(seen[0].links.join(' ')).not.toMatch(/start/i);
    expect(seen[0].links).toEqual(['Demo→/demo', 'Audit trail→/audit', 'Verify a paper→/verify', 'Check my mark→/marks', 'How it works→/#how', 'GitHub→https://github.com/Cage4D/paper-trail']);
    expect(seen.map((s) => s.current)).toEqual([[], ['Demo'], ['Demo'], ['Audit trail'], ['Audit trail'], ['Verify a paper'], ['Check my mark']]);
  });
});
