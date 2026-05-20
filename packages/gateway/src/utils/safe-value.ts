/**
 * Safe Value Utilities
 *
 * Guards against NaN, Infinity, negative values in cost/duration calculations.
 * Centralizes the safeCost pattern originally from ClawManager and FleetManager.
 */

// ============================================================================
// Safe Numeric Guards
// ============================================================================

/**
 * Returns safe finite non-negative number, or fallback.
 * Guards against NaN / Infinity / negative values propagating into budgets/costs.
 */
export function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

/**
 * Returns safe cost (USD), always non-negative finite.
 * Use for any cost field that feeds budget checks.
 */
export function safeCost(cost: unknown): number {
  return safeNumber(cost, 0);
}

/**
 * Returns safe duration (ms), always non-negative whole number.
 */
export function safeDuration(durationMs: unknown): number {
  return Math.floor(safeNumber(durationMs, 0));
}
