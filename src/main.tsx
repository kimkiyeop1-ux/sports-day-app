import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import Home from './pages/Home';
import { registerSW } from './lib/pwa';
import UpdateBanner from './pages/UpdateBanner';

// 관리자 화면 코드는 관리자 주소에 들어갈 때만 내려받는다(전광판 기기에는 전달되지 않음)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const SetupEditor = lazy(() => import('./pages/admin/SetupEditor'));
const ScenarioRun = lazy(() => import('./pages/admin/ScenarioRun'));
const BracketAdmin = lazy(() => import('./pages/admin/BracketAdmin'));
const RefereeAdmin = lazy(() => import('./pages/admin/RefereeAdmin'));
const History = lazy(() => import('./pages/admin/History'));
const Scores = lazy(() => import('./pages/admin/Scores'));
const RevealAdmin = lazy(() => import('./pages/admin/RevealAdmin'));
const Backup = lazy(() => import('./pages/admin/Backup'));
const Reveal = lazy(() => import('./pages/reveal/Reveal'));
const Referee = lazy(() => import('./pages/referee/Referee'));
const PublicBracket = lazy(() => import('./pages/bracket/PublicBracket'));
const Connect = lazy(() => import('./pages/Connect'));
import Board from './pages/board/Board';

// GitHub Pages에서 새로고침해도 404가 나지 않도록 주소에 #을 쓰는 HashRouter 사용
registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <UpdateBanner />
      <Suspense fallback={<div className="page muted">불러오는 중…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="setup" element={<SetupEditor />} />
          <Route path="scenario" element={<ScenarioRun />} />
          <Route path="bracket" element={<BracketAdmin />} />
          <Route path="referee" element={<RefereeAdmin />} />
          <Route path="history" element={<History />} />
          <Route path="scores" element={<Scores />} />
          <Route path="reveal" element={<RevealAdmin />} />
          <Route path="backup" element={<Backup />} />
        </Route>
        <Route path="/board" element={<Board />} />
        <Route path="/bracket" element={<PublicBracket />} />
        <Route path="/bracket/:eventId" element={<PublicBracket />} />
        <Route path="/ref/:eventId/:token" element={<Referee />} />
        <Route path="/reveal/:token" element={<Reveal />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </Suspense>
    </HashRouter>
  </React.StrictMode>,
);
