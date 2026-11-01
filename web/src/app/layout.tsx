/** Shared chrome: header with identity, connection banner, page outlet (T030). */
import { Outlet } from 'react-router';
import { ConnectionBanner } from '../components/index.js';
import { useSession } from '../api/queries.js';
import { VI } from '../i18n/vi.js';

export function AppLayout(): React.JSX.Element {
  const session = useSession();
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{VI.app.title}</h1>
        <span className="session-meta">
          {session.data === undefined
            ? ''
            : `v${session.data.appVersion}${session.data.ai.configured ? ` · ${session.data.ai.model}` : ''}`}
        </span>
      </header>
      <ConnectionBanner />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
