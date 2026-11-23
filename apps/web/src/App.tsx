import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AppPage } from './components/Shell';
import { Audit, AuditIndex } from './pages/Audit';
import { Demo } from './pages/Demo';
import { DemoHome } from './pages/DemoHome';
import { Exam } from './pages/Exam';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';

// Verify and Marks load @paper-trail/core's crypto, so they're split out of the first page load.
const Verify = lazy(() => import('./pages/Verify').then((m) => ({ default: m.Verify })));
const Marks = lazy(() => import('./pages/Marks').then((m) => ({ default: m.Marks })));

function PageLoading() {
  return (
    <AppPage>
      <section className="pt-wrap pt-section pt-col" aria-busy="true" aria-label="Loading">
        <div className="pt-skel pt-skel--title" />
        <div className="pt-skel" style={{ height: 240 }} />
      </section>
    </AppPage>
  );
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <>
      <a className="pt-btn pt-btn--sm pt-skip" href="#main">
        Skip to content
      </a>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/demo" element={<DemoHome />} />
        <Route path="/demo/:demoId" element={<Demo />} />
        <Route path="/demo/:demoId/as/:role" element={<Demo />} />
        <Route path="/audit" element={<AuditIndex />} />
        <Route path="/exams/:examId" element={<Exam />} />
        <Route path="/exams/:examId/audit" element={<Audit />} />
        <Route path="/verify" element={<Suspense fallback={<PageLoading />}><Verify /></Suspense>} />
        <Route path="/marks" element={<Suspense fallback={<PageLoading />}><Marks /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
