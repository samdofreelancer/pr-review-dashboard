/**
 * Repository picker (T049): connect/disconnect repositories, trigger sync,
 * capability warnings, and the authentication repair state.
 *
 * No in-app token form ever renders (FR-011): a missing credential swaps the
 * connect panel for `AuthBanner`. Capability gaps (`pull_requests: false`)
 * surface per repository with repair guidance instead of silent emptiness
 * (FR-009/SC-004). Disconnect goes through the shared confirmation dialog,
 * and every write surface disables while offline (FR-046).
 */
import { useState } from 'react';
import type { Repository } from '@pr-review-dashboard/shared';
import {
  useRepositories,
  useSession,
  connectRepository,
  disconnectRepository,
  startSync,
} from '../../api/queries.js';
import { LoadingState, ErrorState, Banner } from '../../components/states.js';
import { useToast } from '../../components/toast.js';
import { useOffline } from '../../components/StatusBanner.js';
import { viError } from '../../i18n/vi.js';
import { ConfirmActionDialog } from '../board/ConfirmActionDialog.js';
import { AuthBanner } from './AuthBanner.js';
import { SyncStatus } from './SyncStatus.js';
import { VI } from '../../i18n/vi.js';

export function RepositoryPicker(): React.JSX.Element {
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<Repository | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const { show } = useToast();
  const offline = useOffline();
  const session = useSession();
  const reposQuery = useRepositories();

  if (session.isPending || reposQuery.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (session.isError) {
    return (
      <ErrorState
        message={session.error instanceof Error ? session.error.message : String(session.error)}
        onRetry={() => void session.refetch()}
      />
    );
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

  const repairAuth = session.data.viewer === null;
  const repos = reposQuery.data;

  const handleConnect = async (): Promise<void> => {
    setConnecting(true);
    try {
      await connectRepository({ owner: owner.trim(), name: name.trim() });
      setOwner('');
      setName('');
      show({ title: VI.repos.connected, kind: 'success' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: (error instanceof Error ? viError(error.message) : VI.states.errorTitle),
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    } finally {
      setConnecting(false);
    }
  };

  const confirmDisconnect = async (): Promise<void> => {
    if (pendingDisconnect === null) return;
    setDisconnecting(true);
    try {
      await disconnectRepository(pendingDisconnect.id);
      show({ title: VI.repos.disconnected, kind: 'success' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: (error instanceof Error ? viError(error.message) : VI.states.errorTitle),
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    } finally {
      setDisconnecting(false);
      setPendingDisconnect(null);
    }
  };

  const handleSync = async (repoId: string): Promise<void> => {
    setSyncing(repoId);
    try {
      await startSync(repoId);
      show({ title: VI.board.syncing, kind: 'info' });
      void reposQuery.refetch();
    } catch (error) {
      show({
        title: (error instanceof Error ? viError(error.message) : VI.states.errorTitle),
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
      });
    } finally {
      setSyncing(null);
    }
  };

  return (
    <section className="repository-picker">
      <h3>{VI.repos.title}</h3>
      {repairAuth ? (
        <AuthBanner />
      ) : (
        <div className="repo-connect-form">
          <input
            type="text"
            className="repo-input"
            placeholder={VI.repos.owner}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
          <span className="repo-divider">/</span>
          <input
            type="text"
            className="repo-input"
            placeholder={VI.repos.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="repo-connect-button"
            disabled={connecting || offline || owner.trim() === '' || name.trim() === ''}
            onClick={() => void handleConnect()}
          >
            {connecting ? VI.repos.connecting : VI.repos.connect}
          </button>
        </div>
      )}

      {repos.length > 0 && (
        <div className="repo-list">
          <h4>{VI.repos.connectedTitle}</h4>
          {repos.map((repo) => {
            const missingPullRequests = repo.capabilities?.pull_requests === false;
            return (
              <div key={repo.id} className="repo-item">
                <span className="repo-name">
                  {repo.owner}/{repo.name}
                </span>
                <SyncStatus
                  repo={repo}
                  disabled={offline}
                  busy={syncing === repo.id}
                  onSync={() => void handleSync(repo.id)}
                />
                {missingPullRequests ? (
                  <Banner kind="error">
                    <span className="banner-title">{VI.repos.noPullRequestsTitle}</span>{' '}
                    {VI.repos.noPullRequestsBody}
                  </Banner>
                ) : null}
                <div className="repo-actions">
                  <button
                    type="button"
                    className="repo-disconnect-button"
                    disabled={offline}
                    onClick={() => setPendingDisconnect(repo)}
                  >
                    {VI.repos.disconnect}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDisconnect !== null && (
        <ConfirmActionDialog
          open
          destructive
          busy={disconnecting}
          onOpenChange={(open) => {
            if (!open) setPendingDisconnect(null);
          }}
          title={VI.repos.disconnectTitle}
          description={VI.repos.disconnectBody.replace(
            '{repo}',
            `${pendingDisconnect.owner}/${pendingDisconnect.name}`,
          )}
          confirmLabel={VI.repos.disconnectConfirm}
          onConfirm={() => void confirmDisconnect()}
        />
      )}
    </section>
  );
}
