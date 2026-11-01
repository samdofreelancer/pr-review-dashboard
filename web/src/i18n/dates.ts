/**
 * vi-VN formatting helpers (T031).
 *
 * All visible timestamps use the user locale (`vi-VN`) with the fixed
 * `Asia/Ho_Chi_Minh` display zone, matching the all-Vietnamese UI rule;
 * the ISO strings remain canonical over the wire.
 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
});

const RELATIVE_UNITS: readonly Intl.RelativeTimeFormatUnit[] = [
  'year',
  'month',
  'week',
  'day',
  'hour',
  'minute',
];

const UNIT_MS: Readonly<Record<string, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/** `14/03 09:41` style short stamp for dense rows. */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** "2 giờ trước" style caption; falls back to the absolute date for older data. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const delta = now.getTime() - then;
  const relative = new Intl.RelativeTimeFormat('vi-VN', { numeric: 'auto' });
  for (const unit of RELATIVE_UNITS) {
    const unitMs = UNIT_MS[unit] ?? Number.MAX_SAFE_INTEGER;
    if (Math.abs(delta) >= unitMs) {
      return relative.format(-Math.round(delta / unitMs), unit).replace('-', '−');
    }
  }
  return 'vài phút trước';
}
