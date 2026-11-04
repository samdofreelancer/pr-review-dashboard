/**
 * Repository picker (T049): connect/disconnect repositories and trigger sync.
 */
import { useState } from 'react';
import { useRepositories, connectRepository, disconnectRepository, startSync } from '../../api/queries.js';
import { LoadingState, ErrorState } from '../states.js';
import { useToast } from '../toast.js';
import { VI } from '../../i18n/vi.js';

export function RepositoryPicker(): React.JSX.Element {
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const { show } = useToast();

  const reposQuery = useRepositories();

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

  const handleConnect = async (): Promise<void> => {
    setConnecting(true);
    try {
      await connectRepository({ owner, name });
      setOwner('');
      setName('');
      show({ title: 'Đã kết nối', body: `${owner}/${name}`, kind: 'success' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: VI.errors.VALIDATION_FAILED,
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (repoId: string): Promise<void> => {
    if (!window.confirm(VI.actions.confirm)) return;
    try {
      await disconnectRepository(repoId);
      show({ title: 'Đã ngắt kết nối', kind: 'success' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: VI.errors.VALIDATION_FAILED,
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    }
  };

  const handleSync = async (repoId: string): Promise<void> => {
    try {
      await startSync(repoId);
      show({ title: 'Đang đồng bộ', kind: 'info' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: VI.errors.VALIDATION_FAILED,
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    }
  };

  return (
    <section className="repository-picker">
      <h3>{VI.board.connectRepository}</h3>
      <div className="repo-connect-form">
        <input
          type="text"
          className="repo-input"
          placeholder="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <span className="repo-divider">/</span>
        <input
          type="text"
          className="repo-input"
          placeholder="repo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="repo-connect-button"
          disabled={connecting || !owner || !name}
          onClick={() => void handleConnect()}
        >
          {connecting ? 'Đang kết nối…' : 'Kết nối'}
        </button>
      </div>

      {reposQuery.data.length > 0 && (
        <div className="repo-list">
          <h4>Các repository đã kết nối</h4>
          {reposQuery.data.map((repo) => (
            <div key={repo.id} className="repo-item">
              <span className="repo-name">{repo.owner}/{repo.name}</span>
              <span className={`repo-status ${repo.lastSyncStatus}`}>
                {repo.lastSyncStatus}
              </span>
              <div className="repo-actions">
                <button
                  type="button"
                  className="repo-sync-button"
                  onClick={() => void handleSync(repo.id)}
                >
                  Đồng bộ
                </button>
                <button
                  type="button"
                  className="repo-disconnect-button"
                  onClick={() => void handleDisconnect(repo.id)}
                >
                  Ngắt kết nối
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}