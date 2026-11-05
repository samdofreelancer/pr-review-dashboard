/**
 * A single board lane (T047): header + sorted cards with windowed
 * rendering above the virtualization threshold.
 *
 * A lane hardly ever exceeds 100 PRs, but when it does, rendering the whole
 * column becomes the frame budget. Windowing renders the newest window +
 * progressive "show more" disclosures instead of mounting every card.
 */
import { useState } from 'react';
import type { Lane } from '@pr-review-dashboard/shared';
import { BoardCard } from './BoardCard.js';
import { VI } from '../../i18n/vi.js';

/** Cards rendered before windowing engages (exported for the T054 tests). */
export const LANE_WINDOW_SIZE = 100;

export interface BoardLaneProps {
  readonly lane: Lane;
}

export function BoardLane(props: BoardLaneProps): React.JSX.Element {
  const { lane } = props;
  const [windowSize, setWindowSize] = useState(LANE_WINDOW_SIZE);
  const laneLabel = VI.lanes[lane.name] ?? lane.name;

  const visibleCount = Math.min(lane.cards.length, windowSize);
  const windowed = lane.cards.length > windowSize;
  const visible = windowed ? lane.cards.slice(0, visibleCount) : lane.cards;

  return (
    <section className="board-lane">
      <header className="board-lane-header">
        <h2 className="board-lane-title">{laneLabel}</h2>
        <span className="board-lane-count">{lane.count}</span>
      </header>
      <div className="board-lane-cards">
        {lane.cards.length === 0 ? (
          <div className="lane-empty">{VI.board.emptyLaneBody}</div>
        ) : (
          visible.map((card) => <BoardCard key={card.id} card={card} />)
        )}
      </div>
      {windowed ? (
        <div className="lane-window-controls">
          <button
            type="button"
            className="button"
            onClick={() => setWindowSize((size) => size + LANE_WINDOW_SIZE)}
          >
            {VI.board.showMore.replace('{count}', String(lane.cards.length - visibleCount))}
          </button>
          <button type="button" className="button" onClick={() => setWindowSize(lane.cards.length)}>
            {VI.board.showAll}
          </button>
        </div>
      ) : null}
    </section>
  );
}
