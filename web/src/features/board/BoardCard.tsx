/**
 * Single PR card on the board (T047).
 *
 * Displays the PR summary: number, title, author, labels, checks state,
 * mergeability, review decision, and needs-my-review flag. The action menu
 * navigates to the detail page; write actions (mark-ready) first fetch the
 * detail because a board card does not carry the head SHA the mutation
 * verifies against (FR-053). Every write surface reads `useOffline()`.
 */
import type { BoardCard } from '@pr-review-dashboard/shared';
import { useNavigate } from 'react-router';
import { AppMenu, type MenuItemSpec } from '../../components/overlays.js';
import { useToast } from '../../components/toast.js';
import { useOffline } from '../../components/StatusBanner.js';
import { VI, viError } from '../../i18n/vi.js';
import { loadPullRequest, markReadyForReview } from '../../api/queries.js';

export interface BoardCardProps {
  readonly card: BoardCard;
}

const CHECKS_STATE_CLASS: Record<string, string> = {
  failing: 'checks-failing',
  pending: 'checks-pending',
  passing: 'checks-passing',
  neutral: 'checks-neutral',
  none: 'checks-none',
};

const MERGE_BADGE_CLASS: Record<string, string> = {
  mergeable: 'merge-ok',
  conflicting: 'merge-conflicting',
  unknown: 'merge-unknown',
};

export function BoardCard(props: BoardCardProps): React.JSX.Element {
  const { card } = props;
  const navigate = useNavigate();
  const { show } = useToast();
  const offline = useOffline();

  const laneLabel = VI.lanes[card.lane] ?? card.lane;

  const checksLabel =
    {
      failing: VI.checks.failing,
      pending: VI.checks.pending,
      passing: VI.checks.passing,
      neutral: VI.checks.neutral,
      none: VI.checks.none,
    }[card.checksState] ?? card.checksState;

  const mergeLabel =
    card.mergeability === 'mergeable'
      ? VI.merge.mergeable
      : card.mergeability === 'conflicting'
        ? VI.merge.conflicting
        : VI.merge.unknown;

  const reviewLabel =
    card.reviewDecision == null
      ? null
      : card.reviewDecision === 'APPROVED'
        ? VI.reviews.approved
        : card.reviewDecision === 'CHANGES_REQUESTED'
          ? VI.reviews.changesRequested
          : VI.reviews.reviewRequired;

  async function handleMarkReady(): Promise<void> {
    try {
      // A card has no head SHA: the verified-head contract needs the detail.
      const detail = await loadPullRequest(card.id);
      await markReadyForReview(card.id, detail.headSha);
      show({
        title: VI.card.markedReadyTitle,
        body: VI.card.prNumber.replace('{number}', String(card.number)),
        kind: 'success',
      });
    } catch (error) {
      show({
        title: VI.states.errorTitle,
        body: error instanceof Error ? viError(error.message) : String(error),
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
      label: VI.card.markReady,
      disabled: offline,
      onSelect: () => {
        void handleMarkReady();
      },
    },
  ];

  return (
    <article className={`board-card ${CHECKS_STATE_CLASS[card.checksState] ?? 'checks-none'}`}>
      <div className="card-header">
        <span className="card-number">#{card.number}</span>
        <span className="card-lane">{laneLabel}</span>
        {card.needsMyReview && (
          <span
            className="card-needs-review"
            title={VI.board.needsMyReview}
            aria-label={VI.board.needsMyReview}
          >
            ★
          </span>
        )}
        {card.teamRequestIndeterminate && (
          <span className="card-indeterminate" title={VI.card.teamIndeterminate}>
            ?
          </span>
        )}
      </div>
      <h3 className="card-title">{card.title}</h3>
      <div className="card-meta">
        <span className="card-author">{card.author}</span>
        <span className="card-divider">·</span>
        <span className="card-author">
          {card.repository.owner}/{card.repository.name}
        </span>
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
        <span className={`checks-badge ${CHECKS_STATE_CLASS[card.checksState] ?? 'checks-none'}`}>
          {checksLabel}
        </span>
        <span className={`merge-badge ${MERGE_BADGE_CLASS[card.mergeability] ?? 'merge-unknown'}`}>
          {mergeLabel}
        </span>
        {reviewLabel !== null ? (
          <span
            className={`review-badge ${
              card.reviewDecision === 'APPROVED'
                ? 'review-approved'
                : card.reviewDecision === 'CHANGES_REQUESTED'
                  ? 'review-changes'
                  : 'review-pending'
            }`}
          >
            {reviewLabel}
          </span>
        ) : null}
        <AppMenu label={VI.card.menuLabel} items={items} />
      </div>
    </article>
  );
}
