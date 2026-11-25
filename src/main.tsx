import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import Home from './pages/Home';

// 관리자 화면 코드는 관리자 주소에 들어갈 때만 내려받는다(전광판 기기에는 전달되지 않음)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const SetupEditor = lazy(() => import('./pages/admin/SetupEditor'));
const ScenarioRun = lazy(() => import('./pages/admin/ScenarioRun'));
const Connect = lazy(() => import('./pages/Connect'));
import Board from './pages/board/Board';

// GitHub Pages에서 새로고침해도 404가 나지 않도록 주소에 #을 쓰는 HashRouter 사용
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Suspense fallback={<div className="page muted">불러오는 중…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="setup" element={<SetupEditor />} />
          <Route path="scenario" element={<ScenarioRun />} />
        </Route>
        <Route path="/board" element={<Board />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="*" element={<Home />} />
      </Routes>
      </Suspense>
    </HashRouter>
  </React.StrictMode>,
);
