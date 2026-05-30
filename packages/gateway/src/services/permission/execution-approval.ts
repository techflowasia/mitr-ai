/**
 * Execution Approval Service
 *
 * Manages real-time approval requests for 'prompt' mode execution.
 * Flow: SSE event → UI dialog → HTTP POST → resolve promise → execution continues.
 */

import { generateId } from '@ownpilot/core';

/** In-memory pending approvals — keyed by approvalId */
const pendingApprovals = new Map<
  string,
  {
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
    /** UserId of the session that initiated the approval — must match caller */
    ownerUserId: string;
  }
>();

/** Default timeout for approval requests (2 minutes) */
const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Create a pending approval request.
 * Returns a promise that resolves when the user approves/rejects or timeout occurs.
 * Called from chat route's requestApproval callback.
 * @param approvalId  Unique identifier for this approval
 * @param ownerUserId  The userId who initiated this approval — only they may resolve it
 */
export function createApprovalRequest(approvalId: string, ownerUserId: string): Promise<boolean> {
  // Clear any existing approval with the same ID to prevent timer leaks
  const existing = pendingApprovals.get(approvalId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve(false); // Auto-reject the old one
    pendingApprovals.delete(approvalId);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve(false); // Timeout = auto-reject
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(approvalId, { resolve, timer, ownerUserId });
  });
}

/**
 * Resolve a pending approval request.
 * Called from the HTTP endpoint when user clicks approve/reject.
 * Only the userId that created the approval may resolve it (IDOR guard).
 * @returns true if the approval was found, owned by caller, and resolved
 */
export function resolveApproval(
  approvalId: string,
  approved: boolean,
  callerUserId: string
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  // IDOR guard: reject if caller is not the owner of this approval
  if (pending.ownerUserId !== callerUserId) return false;

  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve(approved);
  return true;
}

/**
 * Generate a unique approval ID
 */
export function generateApprovalId(): string {
  return generateId('approval');
}
