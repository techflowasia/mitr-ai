/**
 * Shared formatting utilities
 */

/**
 * Format a large number with K/M suffixes.
 * @param kDecimals decimals for thousands (default 1)
 * @param mDecimals decimals for millions (default 1)
 */
export function formatNumber(
  num: number,
  options?: { kDecimals?: number; mDecimals?: number }
): string {
  const { kDecimals = 1, mDecimals = 1 } = options ?? {};
  if (num >= 1000000) return `${(num / 1000000).toFixed(mDecimals)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(kDecimals)}K`;
  return num.toString();
}

/**
 * Format bytes to human-readable size (B, KB, MB, GB).
 */
/**
 * Strip namespace prefix (e.g. 'core.get_time') and title-case underscored names.
 */
export function formatToolName(name: string): string {
  const base = name.includes('.') ? name.split('.').pop()! : name;
  return base.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/**
 * Format a date string as relative time ("just now", "5m ago", "2h ago", "3d ago").
 * Returns locale date string for dates older than 30 days.
 */
export function timeAgo(
  dateStr: string,
  options?: { absoluteAfterDays?: number; nullLabel?: string }
): string {
  if (!dateStr) return options?.nullLabel ?? '—';
  const dateMs = new Date(dateStr).getTime();
  if (isNaN(dateMs)) return options?.nullLabel ?? '—';
  const diffMs = Date.now() - dateMs;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  const absoluteAfterDays = options?.absoluteAfterDays ?? 30;
  if (diffDays >= absoluteAfterDays) return new Date(dateStr).toLocaleDateString();
  return `${diffDays}d ago`;
}
