/**
 * Status banners (T052): offline detection, rate-limit notice, retry.
 *
 * Offline is the union of two signals (FR-046/SC-008): the SSE stream state
 * (external store from T030, so observing it does not re-render storms) and
 * the browser's own `navigator.online` events. While offline, callers must
 * disable every write surface (sync, review, publish).
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectionState, useRateLimitReset } from '../api/sse.js';
import { Banner } from './states.js';
import { VI } from '../i18n/vi.js';
import { formatDateTime } from '../i18n/dates.js';
import { queryKeys } from '../api/queries.js';

/** True while the SSE stream is down or the browser reports offline. */
export function useOffline(): boolean {
  const connection = useConnectionState();
  const [browserOffline, setBrowserOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const goOnline = (): void => setBrowserOffline(false);
    const goOffline = (): void => setBrowserOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return connection === 'offline' || browserOffline;
}

/** Re-render on a coarse tick so relative/countdown messages advance. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Renders nothing while the app is connected. */
export function OfflineBanner(): ReactElement | null {
  const offline = useOffline();
  if (!offline) return null;
  return <Banner kind="error">{VI.status.offlineBody}</Banner>;
}

/**
 * GitHub rate-limit notice carrying the documented reset window; the retry
 * button refetches app data directly so the user can recover without SSE.
 */
export function RateLimitBanner(): ReactElement | null {
  const resetAt = useRateLimitReset();
  const now = useNow(30_000);
  const queryClient = useQueryClient();

  if (resetAt === null) return null;
  if (new Date(resetAt).getTime() <= now) {
    // Window is over: clear the banner; the next repo.updated refreshes it.
    return <Banner kind="info">{VI.status.rateLimitOpenAgain}</Banner>;
  }
  return (
    <Banner kind="warning">
      <span className="banner-title">
        {VI.status.rateLimitedTitle} — {VI.status.retryAt} {formatDateTime(resetAt)}
      </span>
      <button
        type="button"
        className="button"
        onClick={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.board });
          void queryClient.invalidateQueries({ queryKey: queryKeys.repositories });
        }}
      >
        {VI.status.rateLimitedRetry}
      </button>
    </Banner>
  );
}
