/**
 * The five-lane board (T047): fetches /api/board and renders every lane.
 */
import type { Board } from '@pr-review-dashboard/shared';
import { useBoard } from '../../api/queries.js';
import { BoardLane } from './BoardLane.js';
import { LoadingState, ErrorState } from '../states.js';
import { VI } from '../../i18n/vi.js';

export function Board(): React.JSX.Element {
  const boardQuery = useBoard();

  if (boardQuery.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (boardQuery.isError) {
    return (
      <ErrorState
        message={boardQuery.error instanceof Error ? boardQuery.error.message : String(boardQuery.error)}
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
        <span className="board-total">{total} pull request</span>
      </header>
      <div className="board-lanes">
        {board.lanes.map((lane) => (
          <BoardLane key={lane.name} lane={lane} />
        ))}
      </div>
      {board.stale && (
        <p className="board-stale">{VI.board.staleNotice ?? 'Dữ liệu có thể đã cũ — hãy đồng bộ lại.'}</p>
      )}
    </div>
  );
}