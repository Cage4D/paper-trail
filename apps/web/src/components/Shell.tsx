import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { IconBrandGithub, IconFlask, IconMenu2, IconMoon, IconSun, IconX } from '@tabler/icons-react';
import { BADGE_URL, CONTRACT, PROJECT_URL, REPO_URL } from '../lib/config';
import { useTheme } from '../lib/hooks';
import { getRecentDemo } from '../lib/recent';
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

function useAppLinks() {
  const { pathname } = useLocation();
  const recent = getRecentDemo();
  return [
    { to: recent ? `/demo/${recent.demoId}` : '/', label: 'Demo', current: pathname.startsWith('/demo') },
    { to: recent ? `/exams/${recent.examId}/audit` : '/audit', label: 'Audit', current: pathname === '/audit' || pathname.startsWith('/exams/') },
    { to: '/verify', label: 'Verify', current: pathname === '/verify' },
    { to: '/marks', label: 'Marks', current: pathname === '/marks' },
  ];
}

/** App header on paper: wordmark, links, health, theme toggle. Phone: wordmark + menu sheet. */
export function AppBar() {
  const links = useAppLinks();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <header className="pt-appbar">
      <div className="pt-wrap">
        <Link className="pt-wordmark" to="/">
          paper trail
        </Link>
        <nav className="pt-applinks pt-desktop" aria-label="Main">
          {links.map((l) => (
            <Link key={l.label} to={l.to} aria-current={l.current ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="pt-appbar__tools pt-desktop">
          <HealthChip />
          <ThemeToggle />
        </span>
        <button type="button" className="pt-menubtn pt-phone" aria-expanded={open} aria-controls="pt-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <IconX size={24} stroke={2} aria-hidden /> : <IconMenu2 size={24} stroke={2} aria-hidden />}
        </button>
      </div>
      {open && (
        <div id="pt-sheet" className="pt-sheetmenu pt-phone">
          <nav aria-label="Main">
            {links.map((l) => (
              <Link key={l.label} to={l.to} aria-current={l.current ? 'page' : undefined}>
                {l.label}
              </Link>
            ))}
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
        <span className="pt-desktop-inline">DEMO — testnet only. Demo keys are held by this server; bots play the other roles.</span>
        <span className="pt-phone-inline">DEMO — testnet only. Demo keys are held by this server.</span>
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
