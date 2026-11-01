/**
 * App shell (T030): providers, router, connection stream, page routing.
 *
 * The session query runs once on mount; mutations are disabled until the
 * CSRF token arrives via the typed fetch client. Routes stay at the shell
 * level until US1 (T041+) fills the real board.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '../components/index.js';
import { useEventStream } from '../api/sse.js';
import { AppLayout } from './layout.js';
import { BoardPage } from '../pages/BoardPage.js';
import { PullRequestPage } from '../pages/PullRequestPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <ConnectionGate />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<BoardPage />} />
              <Route path="/prs/:prId" element={<PullRequestPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** Hooks that need provider context live here; rendering none. */
function ConnectionGate(): null {
  useEventStream();
  return null;
}
