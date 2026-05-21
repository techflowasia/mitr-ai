/**
 * SSRF Protection Utilities
 *
 * Shared hostname and DNS-rebinding checks for any gateway code that
 * makes outbound HTTP requests on behalf of users.
 */

import { lookup } from 'node:dns/promises';

/** Private/loopback/metadata hostname prefixes that are always blocked */
const BLOCKED_HOSTS = [
  'localhost',
  '127.',
  '0.0.0.0',
  '10.',
  '192.168.',
  '169.254.',
  '[::1]',
  '[fe80:',
  '[fc00:',
  '[fd00:',
  'metadata.google.internal',
];

/**
 * Quick synchronous check: blocks private hostnames, credentials in URLs,
 * non-HTTP(S) protocols, and numeric IP obfuscation tricks.
 */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (parsed.username || parsed.password) return true;
    const h = parsed.hostname.toLowerCase();
    // Block numeric-only hostnames (IP obfuscation: 0x7f000001, 0177.0.0.1, 2130706433)
    if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(h)) return true;
    // Block 172.16.0.0/12 range
    const m172 = h.match(/^172\.(\d+)\./);
    if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
    return BLOCKED_HOSTS.some((b) => h === b || h.startsWith(b));
  } catch {
    return true;
  }
}

/**
 * Async DNS-rebinding protection: resolves the hostname and checks whether
 * any returned IP is a private/loopback address.
 *
 * Uses a 1-minute cache to avoid repeated DNS lookups for the same host.
 */
const dnsCache = new Map<string, { ips: string[]; ts: number }>();
const DNS_TTL = 60_000;

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

export async function isPrivateUrlAsync(urlString: string): Promise<boolean> {
  try {
    const hostname = new URL(urlString).hostname;
    const now = Date.now();
    const cached = dnsCache.get(hostname);
    let ips: string[];

    if (cached && now - cached.ts < DNS_TTL) {
      ips = cached.ips;
    } else {
      const records = await lookup(hostname, { all: true });
      ips = records.map((r) => r.address);
      dnsCache.set(hostname, { ips, ts: now });
    }

    return ips.some((ip) => PRIVATE_RANGES.some((re) => re.test(ip)));
  } catch {
    return true; // DNS failure: block the request (fail-closed for safety)
  }
}

/**
 * Uncached variant of {@link isPrivateUrlAsync} — performs a fresh DNS lookup
 * every call. Use this as the LAST guard immediately before the actual fetch
 * to narrow the DNS-rebinding TOCTOU window (H-S4): cached resolutions can
 * return a public IP while a subsequent fetch resolves to a private one.
 *
 * Residual risk: there is still a microsecond gap between this lookup and
 * the libuv/undici DNS lookup inside `fetch`. A complete fix requires
 * hostname-pinning via `undici.Agent.connect.lookup`, which would add an
 * `undici` runtime dependency. This function reduces the practical exposure
 * by ~6 orders of magnitude (60s cache → microsecond gap) without that dep.
 */
export async function isPrivateUrlAsyncFresh(urlString: string): Promise<boolean> {
  try {
    const hostname = new URL(urlString).hostname;
    const records = await lookup(hostname, { all: true });
    const ips = records.map((r) => r.address);
    // Refresh the cache opportunistically — anything else that looked up the
    // same hostname recently gets the same answer we are about to act on.
    dnsCache.set(hostname, { ips, ts: Date.now() });
    return ips.some((ip) => PRIVATE_RANGES.some((re) => re.test(ip)));
  } catch {
    return true;
  }
}
