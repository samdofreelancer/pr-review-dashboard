/**
 * The five-lane board (T047): fetches /api/board (via filters) and renders
 * every lane in display order with visible counts and a total.
 */
import type { BoardFiltersState } from './BoardFilters.js';
import { useBoard } from '../../api/queries.js';
import { BoardLane } from './BoardLane.js';
import { LoadingState, ErrorState } from '../../components/states.js';
import { VI } from '../../i18n/vi.js';

export interface BoardProps {
  readonly filters?: BoardFiltersState;
}

export function Board(props: BoardProps): React.JSX.Element {
  const boardQuery = useBoard(props.filters);

  if (boardQuery.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (boardQuery.isError) {
    return (
      <ErrorState
        message={
          boardQuery.error instanceof Error ? boardQuery.error.message : String(boardQuery.error)
        }
        onRetry={() => void boardQuery.refetch()}
      />
    );
  }

  const board = boardQuery.data;
  if (!board) {
    return <LoadingState label={VI.states.loading} />;
  }
  const total = board.lanes.reduce((sum, lane) => sum + lane.cards.length, 0);

  return (
    <div className="board">
      <header className="board-header">
        <h1>{VI.board.emptyTitle}</h1>
        <span className="board-total">{VI.board.totalCount.replace('{count}', String(total))}</span>
      </header>
      <div className="board-lanes">
        {board.lanes.map((lane) => (
          <BoardLane key={lane.name} lane={lane} />
        ))}
      </div>
      {board.stale && <p className="board-stale">{VI.board.staleNotice}</p>}
    </div>
  );
}
