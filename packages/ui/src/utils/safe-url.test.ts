import { describe, it, expect } from 'vitest';
import { isSafeUrl, safeHref } from './safe-url';

describe('isSafeUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('https://example.com/path?q=1#frag')).toBe(true);
  });

  it('accepts mailto links', () => {
    expect(isSafeUrl('mailto:alice@example.com')).toBe(true);
  });

  it('rejects javascript: URLs (case + whitespace variants)', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('\tjavascript:alert(1)')).toBe(false);
    // Control-char smuggling — `java\tscript:` is interpreted by some
    // browsers as `javascript:` after stripping the tab.
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false);
  });

  it('rejects data:, vbscript:, file:, blob: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('blob:https://example.com/abc')).toBe(false);
  });

  it('rejects relative and protocol-less inputs', () => {
    expect(isSafeUrl('/relative')).toBe(false);
    expect(isSafeUrl('example.com')).toBe(false);
    expect(isSafeUrl('//attacker.com')).toBe(false);
  });

  it('rejects empty / non-string / unparseable input', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(123)).toBe(false);
    expect(isSafeUrl('http://')).toBe(false);
  });
});

describe('safeHref', () => {
  it('returns the URL when safe', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
  });

  it('returns undefined when unsafe', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});
