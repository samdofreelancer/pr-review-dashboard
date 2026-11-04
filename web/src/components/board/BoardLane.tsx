/**
 * A single board lane (T047): header + cards, sorted newest-first.
 */
import type { Lane } from '@pr-review-dashboard/shared';
import { BoardCard } from './BoardCard.js';
import { VI } from '../../i18n/vi.js';

export interface BoardLaneProps {
  readonly lane: Lane;
}

export function BoardLane(props: BoardLaneProps): React.JSX.Element {
  const { lane } = props;
  const laneLabel = VI.lanes[lane.name] ?? lane.name;

  return (
    <section className="board-lane">
      <header className="board-lane-header">
        <h2 className="board-lane-title">{laneLabel}</h2>
        <span className="board-lane-count">{lane.cards.length}</span>
      </header>
      <div className="board-lane-cards">
        {lane.cards.length === 0 ? (
          <div className="lane-empty">{VI.board.emptyLaneBody ?? 'Trống'}</div>
        ) : (
          lane.cards.map((card) => (
            <BoardCard key={card.id} card={card} />
          ))
        )}
      </div>
    </section>
  );
}