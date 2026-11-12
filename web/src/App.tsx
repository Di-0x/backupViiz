import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { RedirectIfAuthed, RequireAuth } from './auth/AuthContext';
import { Skeleton } from './components/Skeleton';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';

// Pages non critiques et éditeur (React Flow) : chargés à la demande.
const Register = lazy(() => import('./pages/Register'));
const Account = lazy(() => import('./pages/Account'));
const ReportPage = lazy(() => import('./report/ReportPage'));
const StrategyEditorPage = lazy(() => import('./editor/StrategyEditorPage'));

function PageFallback() {
  return (
    <div className="container" role="status" aria-label="Chargement">
      <Skeleton height={32} width="40%" />
      <div style={{ height: 16 }} />
      <Skeleton height={240} />
    </div>
  );
}

function NotFound() {
  return (
    <main className="container" id="main">
      <h1>Page introuvable</h1>
      <p><Link to="/">Retour aux stratégies</Link></p>
    </main>
  );
}

export function App() {
  return (
    <>
      <a href="#main" className="skip-link">Aller au contenu</a>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
          <Route path="/register" element={<RedirectIfAuthed><Register /></RedirectIfAuthed>} />
          <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/s/:id" element={<RequireAuth><StrategyEditorPage /></RequireAuth>} />
          <Route path="/s/:id/report" element={<RequireAuth><ReportPage /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
