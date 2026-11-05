/**
 * Board filter bar (T048): search, repository filter, needs-my-review.
 *
 * Fully controlled: `BoardPage` owns the state and the 300 ms search
 * debounce, so every keystroke lands in the query key through one path.
 * The clear control intentionally PRESERVES the repository selection; only
 * the text search and the needs-my-review toggle reset (FR-041/042).
 */
import type { ReactElement } from 'react';
import { useRepositories } from '../../api/queries.js';
import { LoadingState, ErrorState } from '../../components/states.js';
import { VI } from '../../i18n/vi.js';

export interface BoardFiltersState {
  readonly repoId: string | null;
  readonly q: string;
  readonly needsMyReview: boolean;
}

export interface BoardFiltersProps {
  readonly value: BoardFiltersState;
  readonly onChange: (next: BoardFiltersState) => void;
}

export function BoardFilters(props: BoardFiltersProps): ReactElement {
  const reposQuery = useRepositories();
  const { value, onChange } = props;

  if (reposQuery.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (reposQuery.isError) {
    return (
      <ErrorState
        message={
          reposQuery.error instanceof Error ? reposQuery.error.message : String(reposQuery.error)
        }
        onRetry={() => void reposQuery.refetch()}
      />
    );
  }

  return (
    <div className="filter-bar">
      <div className="filter-search">
        <label className="filter-label" htmlFor="board-filter-q">
          {VI.board.searchLabel}
        </label>
        <input
          id="board-filter-q"
          type="text"
          className="filter-input"
          placeholder={VI.board.searchPlaceholder}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </div>

      <div className="filter-repo">
        <label className="filter-label" htmlFor="board-filter-repo">
          {VI.board.repoFilterLabel}
        </label>
        <select
          id="board-filter-repo"
          className="filter-select"
          value={value.repoId ?? ''}
          onChange={(e) => onChange({ ...value, repoId: e.target.value || null })}
        >
          <option value="">{VI.board.allRepositories}</option>
          {reposQuery.data.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.owner}/{repo.name}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-toggle">
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={value.needsMyReview}
            onChange={(e) => onChange({ ...value, needsMyReview: e.target.checked })}
          />
          {VI.board.needsMyReview}
        </label>
      </div>

      <button
        type="button"
        className="filter-clear"
        onClick={() => onChange({ repoId: value.repoId, q: '', needsMyReview: false })}
      >
        {VI.filters.clear}
      </button>
    </div>
  );
}
