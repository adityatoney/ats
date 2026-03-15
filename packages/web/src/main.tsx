import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { AgentDetailPage } from './components/agent/AgentDetailPage';
import { CreateAgentPage } from './components/agent/CreateAgentPage';
import { RunDetailPage } from './components/run/RunDetailPage';
import { BacktestConfigForm } from './components/backtest/BacktestConfigForm';
import { TournamentListPage } from './components/tournament/TournamentListPage';
import { CreateTournamentPage } from './components/tournament/CreateTournamentPage';
import { TournamentDetailPage } from './components/tournament/TournamentDetailPage';
import { AgentComparisonPage } from './components/tournament/AgentComparisonPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/agents/new" element={<CreateAgentPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/agents/:id/backtest" element={<BacktestConfigForm />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/tournaments" element={<TournamentListPage />} />
          <Route path="/tournaments/new" element={<CreateTournamentPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/tournaments/:id/compare" element={<AgentComparisonPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
