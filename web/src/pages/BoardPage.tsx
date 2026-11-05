/**
 * Board page (T047–T052): status banners, repository picker, filter bar,
 * and the five-lane board.
 *
 * Filter state lives here: the text query debounces 300 ms before it feeds
 * the board query key, while the repository select and needs-my-review
 * toggle react immediately (FR-041/042/046).
 */
import { useEffect, useMemo, useState } from 'react';
import { ErrorState, LoadingState, Banner } from '../components/index.js';
import { OfflineBanner } from '../components/StatusBanner.js';
import { useRepositories, useSession } from '../api/queries.js';
import { VI, viError } from '../i18n/vi.js';
import { Board } from '../features/board/Board.js';
import { BoardFilters, type BoardFiltersState } from '../features/board/BoardFilters.js';
import { RepositoryPicker } from '../features/repos/RepositoryPicker.js';

/** Returns `value` only after it stayed unchanged for `delayMs`. */
function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return (): void => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function BoardPage(): React.JSX.Element {
  const session = useSession();
  const reposQuery = useRepositories();

  const [filters, setFilters] = useState<BoardFiltersState>({
    repoId: null,
    q: '',
    needsMyReview: false,
  });

  const debouncedQ = useDebouncedValue(filters.q, 300);
  // Stable identity between keystrokes: only the debounced query and the
  // instant toggles may change the board query key.
  const boardFilters = useMemo(
    () => ({
      repoId: filters.repoId,
      q: debouncedQ,
      needsMyReview: filters.needsMyReview,
    }),
    [filters.repoId, filters.needsMyReview, debouncedQ],
  );

  if (session.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (session.isError) {
    return <ErrorState message={viError('OFFLINE')} onRetry={() => void session.refetch()} />;
  }

  // At least one connected repository failed its last run: honest banner.
  const problemRepos = (reposQuery.data ?? []).filter(
    (repo) => repo.lastSyncStatus === 'partial' || repo.lastSyncStatus === 'failed',
  );
  const syncProblems = problemRepos.length > 0;

  return (
    <div className="board-page">
      <header className="board-page-header">
        <h1>{VI.app.title}</h1>
        <RepositoryPicker />
      </header>

      <OfflineBanner />
      {syncProblems && problemRepos.some((repo) => repo.lastSyncStatus === 'partial') ? (
        <Banner kind="warning">{VI.repos.partialBanner}</Banner>
      ) : null}
      {syncProblems && problemRepos.some((repo) => repo.lastSyncStatus === 'failed') ? (
        <Banner kind="error">{VI.repos.failedBanner}</Banner>
      ) : null}

      <BoardFilters value={filters} onChange={setFilters} />

      <main className="board-page-main">
        <Board filters={boardFilters} />
      </main>
    </div>
  );
}
