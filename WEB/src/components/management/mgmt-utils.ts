/**
 * Shared helpers for the management UI.
 */
import type { MgmtUser, MgmtApiKey } from '@/lib/api-mgmt';

/** Format an ISO date string; return `—` for null/undefined. */
export function fmtDate(iso: string | null | undefined, locale = 'ru-RU'): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

/** Format a date as a relative "time ago" string. */
export function fmtAgo(iso: string | null | undefined, locale = 'ru-RU'): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return '—';
    const diff = Date.now() - d;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return locale === 'ru-RU' ? 'только что' : 'just now';
    if (min < 60) return locale === 'ru-RU' ? `${min} мин назад` : `${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return locale === 'ru-RU' ? `${hours} ч назад` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return locale === 'ru-RU' ? `${days} дн назад` : `${days}d ago`;
    return fmtDate(iso, locale);
  } catch {
    return '—';
  }
}

/** True if is_active is truthy (handles both bool and 0/1). */
export function isActive(v: number | boolean | undefined | null): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** True if the API key has already expired. */
export function isExpired(key: MgmtApiKey): boolean {
  if (!key.expires_at) return false;
  try {
    return new Date(key.expires_at).getTime() < Date.now();
  } catch {
    return false;
  }
}

/** Build a CSV string from audit entries and trigger a download. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Pretty-print a JSON value for the audit "details" column. */
export function fmtDetails(d: unknown): string {
  if (d === null || d === undefined || d === '') return '';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

/** Quick "is this user active" predicate for filter UIs. */
export function userActive(u: MgmtUser): boolean {
  return isActive(u.is_active);
}

/** Quick "is this key active and not expired" predicate. */
export function keyActive(k: MgmtApiKey): boolean {
  return isActive(k.is_active) && !isExpired(k);
}
