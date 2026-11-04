/** 404 route safety net (T030). */
import { EmptyState } from '../components/index.js';
import { viError } from '../i18n/vi.js';

export function NotFoundPage(): React.JSX.Element {
  return <EmptyState title={viError('NOT_FOUND')} />;
}
