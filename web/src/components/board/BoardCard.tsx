/**
 * Single PR card on the board (T047).
 *
 * Displays the PR summary: number, title, author, labels, checks state,
 * mergeability, review decision, and needs-my-review flag. An action menu
 * offers mark-ready and navigate-to-detail.
 */
import type { BoardCard } from '@pr-review-dashboard/shared';
import { useNavigate } from 'react-router';
import { AppMenu, type MenuItemSpec } from '../overlays.js';
import { useToast } from '../toast.js';
import { VI } from '../../i18n/vi.js';
import { markReadyForReview } from '../../api/queries.js';

export interface BoardCardProps {
  readonly card: BoardCard;
}

const CHECKS_LABEL: Record<string, string> = {
  failing: 'Kiểm tra thất bại',
  pending: 'Đang kiểm tra',
  passing: 'Đã pass',
  neutral: 'Trung tính',
  none: 'Chưa có',
};

const CHECKS_CLASS: Record<string, string> = {
  failing: 'checks-failing',
  pending: 'checks-pending',
  passing: 'checks-passing',
  neutral: 'checks-neutral',
  none: 'checks-none',
};

export function BoardCard(props: BoardCardProps): React.JSX.Element {
  const { card } = props;
  const navigate = useNavigate();
  const { show } = useToast();

  const laneLabel = VI.lanes[card.lane] ?? card.lane;

  async function handleMarkReady(card: BoardCard): Promise<void> {
    try {
      await markReadyForReview(card.id, '');
      show({
        title: 'Đã đánh dấu sẵn sàng',
        body: `PR #${card.number}`,
        kind: 'success',
      });
    } catch (error) {
      show({
        title: VI.errors.VALIDATION_FAILED,
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    }
  }

  const items: readonly MenuItemSpec[] = [
    {
      label: VI.actions.viewDetails,
      onSelect: () => {
        void navigate(`/prs/${card.id}`);
      },
    },
    {
      label: 'Đánh dấu đã sẵn sàng review',
      onSelect: () => {
        void handleMarkReady(card);
      },
    },
    {
      label: VI.actions.cancel,
      destructive: false,
      onSelect: () => undefined,
    },
  ];

  return (
    <article className={`board-card ${CHECKS_CLASS[card.checksState] ?? 'checks-none'}`}>
      <div className="card-header">
        <span className="card-number">#{card.number}</span>
        <span className="card-lane">{laneLabel}</span>
        {card.needsMyReview && (
          <span className="card-needs-review" title={VI.board.needsMyReview}>
            ★
          </span>
        )}
        {card.teamRequestIndeterminate && (
          <span className="card-indeterminate" title="Đội nhóm chưa xác định">?</span>
        )}
      </div>
      <h3 className="card-title">{card.title}</h3>
      <div className="card-meta">
        <span className="card-author">{card.author}</span>
        <span className="card-divider">·</span>
        <span className="card-author">{card.repository.owner}/{card.repository.name}</span>
      </div>
      {card.labels?.length ? (
        <div className="card-labels">
          {card.labels.map((label) => (
            <span
              key={label.name}
              className="card-label"
              style={{
                backgroundColor: label.color ?? '#e1e4e8',
                color: label.color ? '#fff' : '#333',
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="card-footer">
        <span className={`checks-badge ${CHECKS_CLASS[card.checksState] ?? 'checks-none'}`}>
          {CHECKS_LABEL[card.checksState] ?? card.checksState}
        </span>
        <span className={`merge-badge ${card.mergeability === 'conflicting' ? 'merge-conflicting' : ''}`}>
          {card.mergeability === 'conflicting' ? 'Xung đột' : card.mergeability === 'mergeable' ? 'Merge được' : 'Không rõ'}
        </span>
        {card.reviewDecision ? (
          <span className={`review-badge ${card.reviewDecision.toLowerCase()}`}>
            {card.reviewDecision === 'APPROVED' ? 'Duyệt' : card.reviewDecision === 'CHANGES_REQUESTED' ? 'Yêu cầu sửa' : 'Chờ review'}
          </span>
        ) : null}
        <AppMenu label="Hành động" items={items} />
      </div>
    </article>
  );
}