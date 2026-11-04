/**
 * Board filter bar (T048): search, repository filter, needs-my-review toggle.
 */
import { useState } from 'react';
import { useRepositories } from '../../api/queries.js';
import { LoadingState, ErrorState } from '../states.js';
import { VI } from '../../i18n/vi.js';

export interface FilterBarProps {
  readonly onFiltersChange: (filters: {
    readonly repoId: string | null;
    readonly q: string;
    readonly needsMyReview: boolean;
  }) => void;
}

export function FilterBar(props: FilterBarProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [needsMyReview, setNeedsMyReview] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  const reposQuery = useRepositories();

  const handleChange = (): void => {
    props.onFiltersChange({
      repoId: selectedRepoId,
      q: query,
      needsMyReview,
    });
  };

  if (reposQuery.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (reposQuery.isError) {
    return (
      <ErrorState
        message={reposQuery.error instanceof Error ? reposQuery.error.message : String(reposQuery.error)}
        onRetry={() => void reposQuery.refetch()}
      />
    );
  }

  return (
    <div className="filter-bar">
      <div className="filter-search">
        <label className="filter-label">{VI.board.searchPlaceholder}</label>
        <input
          type="text"
          className="filter-input"
          placeholder={VI.board.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleChange();
          }}
        />
      </div>

      <div className="filter-repo">
        <label className="filter-label">{VI.board.filterByLabel}</label>
        <select
          className="filter-select"
          value={selectedRepoId ?? ''}
          onChange={(e) => setSelectedRepoId(e.target.value || null)}
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
            checked={needsMyReview}
            onChange={(e) => setNeedsMyReview(e.target.checked)}
          />
          {VI.board.needsMyReview ?? 'Yêu cầu review của tôi'}
        </label>
      </div>

      <button type="button" className="filter-apply" onClick={handleChange}>
        {VI.board.sync}
      </button>
    </div>
  );
}