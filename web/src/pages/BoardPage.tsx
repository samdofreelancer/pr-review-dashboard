/** Board shell page (T030): placeholder until US1 board lands (T041+). */
import { ErrorState, EmptyState, LoadingState } from '../components/index.js';
import { useSession } from '../api/queries.js';
import { VI, viError } from '../i18n/vi.js';

export function BoardPage(): React.JSX.Element {
  const session = useSession();
  if (session.isPending) {
    return <LoadingState label={VI.states.loading} />;
  }
  if (session.isError) {
    return <ErrorState message={viError('OFFLINE')} onRetry={() => void session.refetch()} />;
  }
  return <EmptyState title={VI.board.emptyTitle} body={VI.board.emptyBody} />;
}
