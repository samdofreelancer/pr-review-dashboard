/** Pull request detail placeholder (T030); filled by US2 diff slices. */
import { useParams } from 'react-router';
import { EmptyState } from '../components/index.js';
import { VI } from '../i18n/vi.js';

export function PullRequestPage(): React.JSX.Element {
  const { prId } = useParams();
  return <EmptyState title={`PR ${prId ?? ''}`} body={VI.states.empty} />;
}
