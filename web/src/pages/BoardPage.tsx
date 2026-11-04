/**
 * Board page (T047–T052): filter bar, repository picker, five-lane board.
 */
import { ErrorState, LoadingState } from '../components/index.js';
import { useSession } from '../api/queries.js';
import { VI, viError } from '../i18n/vi.js';
import { FilterBar } from '../components/board/FilterBar.js';
import { RepositoryPicker } from '../components/board/RepositoryPicker.js';
import { Board } from '../components/board/Board.js';

export function BoardPage(): React.JSX.Element {
  const session = useSession();

  if (session.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (session.isError) {
    return <ErrorState message={viError('OFFLINE')} onRetry={() => void session.refetch()} />;
  }

  return (
    <div className="board-page">
      <header className="board-page-header">
        <h1>{VI.app.title}</h1>
        <RepositoryPicker />
      </header>

      <FilterBar onFiltersChange={() => undefined} />

      <main className="board-page-main">
        <Board />
      </main>
    </div>
  );
}
