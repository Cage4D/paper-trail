import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AppPage } from './components/Shell';
import { Demo } from './pages/Demo';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Placeholder({ title }: { title: string }) {
  return (
    <AppPage>
      <section className="pt-wrap pt-section">
        <h1 className="pt-h1">{title}</h1>
      </section>
    </AppPage>
  );
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
        <Route path="/demo/:demoId" element={<Demo />} />
        <Route path="/demo/:demoId/as/:role" element={<Demo />} />
        <Route path="/audit" element={<Placeholder title="Audit trail" />} />
        <Route path="/exams/:examId" element={<Placeholder title="Exam" />} />
        <Route path="/exams/:examId/audit" element={<Placeholder title="Audit trail" />} />
        <Route path="/verify" element={<Placeholder title="Verify a paper" />} />
        <Route path="/marks" element={<Placeholder title="Check my mark" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
