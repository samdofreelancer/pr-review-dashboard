/**
 * Banners and page states (T031).
 *
 * - Banner: connection/offline/warning strips driven by the SSE store.
 * - Loading/Empty/Error: the only three non-data shapes any list may render;
 *   failures must never be displayed as success (audit rule T107 enforces).
 */
import type { ReactNode, ReactElement } from 'react';
import { VI } from '../i18n/vi.js';
import { useConnectionState } from '../api/sse.js';

export type BannerKind = 'info' | 'warning' | 'error';

export function Banner(props: {
  readonly kind: BannerKind;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div role="status" className={`banner banner-${props.kind}`}>
      {props.children}
    </div>
  );
}

/** Global connection banner; renders nothing while the stream is healthy. */
export function ConnectionBanner(): ReactElement | null {
  const state = useConnectionState();
  if (state === 'online') return null;
  return (
    <Banner kind={state === 'offline' ? 'error' : 'warning'}>
      {state === 'offline' ? VI.app.offline : VI.app.reconnecting}
    </Banner>
  );
}

export function LoadingState(props: { readonly label?: string }): ReactElement {
  return (
    <div role="status" aria-live="polite" className="state state-loading">
      {props.label ?? VI.states.loading}
    </div>
  );
}

export function EmptyState(props: {
  readonly title: string;
  readonly body?: string;
}): ReactElement {
  return (
    <div className="state state-empty">
      <p className="state-title">{props.title}</p>
      {props.body !== undefined ? <p className="state-body">{props.body}</p> : null}
    </div>
  );
}

export function ErrorState(props: {
  readonly message: string;
  readonly onRetry?: () => void;
}): ReactElement {
  return (
    <div role="alert" className="state state-error">
      <p className="state-title">{VI.states.errorTitle}</p>
      <p className="state-body">{props.message}</p>
      {props.onRetry !== undefined ? (
        <button type="button" className="button" onClick={props.onRetry}>
          {VI.states.retry}
        </button>
      ) : null}
    </div>
  );
}
