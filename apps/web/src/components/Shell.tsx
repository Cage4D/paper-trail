import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { IconBrandGithub, IconFlask, IconMenu2, IconMoon, IconSun, IconX } from '@tabler/icons-react';
import { BADGE_URL, CONTRACT, PROJECT_URL, REPO_URL } from '../lib/config';
import { useTheme } from '../lib/hooks';
import { HashLink } from './HashLink';
import { HealthChip } from './HealthChip';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'ink' ? 'light' : 'dark';
  return (
    <button type="button" className="pt-iconbtn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'ink' ? <IconSun size={20} stroke={2} aria-hidden /> : <IconMoon size={20} stroke={2} aria-hidden />}
    </button>
  );
}

/** The global navigation: the same links, in the same order, on every page. Only the highlight moves. */
const NAV = [
  { to: '/', label: 'Home', hint: 'What Paper Trail is and how it works', match: (p: string) => p === '/' },
  { to: '/demo', label: 'Live demo', hint: 'A 3-minute walkthrough on the real blockchain', match: (p: string) => p.startsWith('/demo') },
  { to: '/try', label: 'Try encryption', hint: 'Lock and open messages in your own browser', match: (p: string) => p === '/try' },
  { to: '/audit', label: 'Audit trail', hint: "Every step of an exam, on public record", match: (p: string) => p === '/audit' || p.startsWith('/exams/') },
  { to: '/verify', label: 'Verify a paper', hint: "Check a paper is exactly the one that was set", match: (p: string) => p === '/verify' },
  { to: '/marks', label: 'Check my mark', hint: 'Prove your mark with the code name on your ticket', match: (p: string) => p === '/marks' },
] as const;

/** The global links. `withHints` (the phone menu) shows each link's one-line explanation under it. */
function NavLinks({ withHints = false }: { withHints?: boolean }) {
  const { pathname } = useLocation();
  return (
    <>
      {NAV.map((l) => (
        <Link key={l.label} to={l.to} title={withHints ? undefined : l.hint} aria-current={l.match(pathname) ? 'page' : undefined} className={withHints ? 'pt-navhint' : undefined}>
          {withHints ? (
            <span className="pt-col" style={{ gap: 2 }}>
              <span>{l.label}</span>
              <span className="pt-navhint__text">{l.hint}</span>
            </span>
          ) : (
            l.label
          )}
        </Link>
      ))}
      <a href={REPO_URL} target="_blank" rel="noreferrer" title="The source code on GitHub" className={withHints ? 'pt-navhint' : undefined}>
        {withHints ? (
          <span className="pt-col" style={{ gap: 2 }}>
            <span>GitHub</span>
            <span className="pt-navhint__text">The source code</span>
          </span>
        ) : (
          'GitHub'
        )}
      </a>
    </>
  );
}

/** The one site header, identical on every page: wordmark, links, health, theme toggle. Phone: wordmark + menu sheet. */
export function AppBar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { hash } = useLocation();
  useEffect(() => setOpen(false), [pathname, hash]);
  return (
    <header className="pt-appbar">
      <div className="pt-wrap">
        <Link className="pt-wordmark" to="/">
          paper trail
        </Link>
        <nav className="pt-applinks pt-navwide" aria-label="Main">
          <NavLinks />
        </nav>
        <span className="pt-appbar__tools pt-navwide">
          <HealthChip />
          <ThemeToggle />
        </span>
        <button type="button" className="pt-menubtn pt-navnarrow" aria-expanded={open} aria-controls="pt-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <IconX size={24} stroke={2} aria-hidden /> : <IconMenu2 size={24} stroke={2} aria-hidden />}
        </button>
      </div>
      {open && (
        <div id="pt-sheet" className="pt-sheetmenu pt-navnarrow">
          <nav aria-label="Main">
            <NavLinks withHints />
          </nav>
          <div className="pt-sheetmenu__tools">
            <HealthChip />
            <ThemeToggle />
          </div>
        </div>
      )}
    </header>
  );
}

/** Pink strip pinned at the top of every judge-mode screen. */
export function DemoBar({ demoId }: { demoId?: string }) {
  return (
    <div className="pt-demobar" role="note">
      <div className="pt-wrap">
        <IconFlask size={18} stroke={2} aria-hidden />
        <span className="pt-desktop-inline">DEMO — testnet only. A practice blockchain: nothing costs real money. The server holds the demo keys and bots play the other roles.</span>
        <span className="pt-phone-inline">DEMO — testnet only. Practice blockchain, demo keys.</span>
        {demoId && <span className="pt-demobar__id pt-desktop-inline">demo {demoId.slice(0, 8)}</span>}
      </div>
    </div>
  );
}

/** Footer: follows the site theme like everything else. */
export function Footer() {
  return (
    <footer className="pt-footer">
      <div className="pt-wrap">
        <Link className="pt-wordmark" to="/">
          paper trail
        </Link>
        <span className="pt-footer__items">
          <span className="pt-chip pt-chip--demo">
            <IconFlask size={15} stroke={2} aria-hidden />
            DEMO — testnet only
          </span>
          <HealthChip long />
          <HashLink value={CONTRACT} kind="address" label="contract" small />
          <a className="pt-footer__gh" href={REPO_URL} target="_blank" rel="noreferrer">
            <IconBrandGithub size={18} stroke={2} aria-hidden />
            Source
          </a>
          <a href={PROJECT_URL} target="_blank" rel="noreferrer" className="pt-badge">
            <img src={BADGE_URL} alt="Built on QoreChain" height={28} />
          </a>
        </span>
      </div>
    </footer>
  );
}

/** Paper app page: header, content, footer. */
export function AppPage({ children, demoId }: { children: ReactNode; demoId?: string }) {
  return (
    <div className="pt-page pt-app">
      {demoId !== undefined && <DemoBar demoId={demoId} />}
      <AppBar />
      <main id="main" className="pt-main">
        {children}
      </main>
      <Footer />
    </div>
  );
}
