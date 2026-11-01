// Fixed locale and time zone for every number and date on the dashboard.
// These components render on the server and again in the browser; bare
// toLocaleString() used each side's own locale (en-US on the server vs the
// browser's en-IN, e.g. "394,147" vs "3,94,147"), which broke hydration.

const LOCALE = 'en-IN';
const TIME_ZONE = 'Asia/Kolkata';

const numberFormat = new Intl.NumberFormat(LOCALE);

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TIME_ZONE });
}

export function formatBucket(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric' });
}
