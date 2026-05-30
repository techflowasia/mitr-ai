/**
 * Execution Approval Service Tests
 *
 * Tests the approval request lifecycle: creation, resolution (approve/reject),
 * timeout behaviour, duplicate handling, concurrent approvals, and ID generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @ownpilot/core — provide a deterministic generateId
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test_123`),
}));

import { generateId } from '@ownpilot/core';
import {
  createApprovalRequest,
  resolveApproval,
  generateApprovalId,
} from './execution-approval.js';

const TEST_USER = 'test-user';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('execution-approval', () => {
  // -----------------------------------------------------------------------
  // createApprovalRequest
  // -----------------------------------------------------------------------

  describe('createApprovalRequest', () => {
    it('returns a promise', () => {
      const promise = createApprovalRequest('create-1', TEST_USER);
      expect(promise).toBeInstanceOf(Promise);
      // Clean up so the timer does not leak
      resolveApproval('create-1', false, TEST_USER);
    });

    it('resolves to true when approved via resolveApproval', async () => {
      const promise = createApprovalRequest('create-approve', TEST_USER);
      resolveApproval('create-approve', true, TEST_USER);
      const result = await promise;
      expect(result).toBe(true);
    });

    it('resolves to false when rejected via resolveApproval', async () => {
      const promise = createApprovalRequest('create-reject', TEST_USER);
      resolveApproval('create-reject', false, TEST_USER);
      const result = await promise;
      expect(result).toBe(false);
    });

    it('resolves to false after the 120s timeout', async () => {
      const promise = createApprovalRequest('timeout-1', TEST_USER);

      // Advance time past the 120,000ms timeout
      vi.advanceTimersByTime(120_001);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('does not resolve before the timeout elapses', async () => {
      const promise = createApprovalRequest('timeout-2', TEST_USER);
      let resolved = false;

      promise.then(() => {
        resolved = true;
      });

      // Advance time to just before the timeout
      vi.advanceTimersByTime(119_999);
      // Flush microtasks so .then() would run if the promise had resolved
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved).toBe(false);

      // Clean up
      vi.advanceTimersByTime(1);
      await promise;
    });

    it('handles multiple concurrent approvals independently', async () => {
      const promise1 = createApprovalRequest('multi-1', TEST_USER);
      const promise2 = createApprovalRequest('multi-2', TEST_USER);
      const promise3 = createApprovalRequest('multi-3', TEST_USER);

      // Resolve the first as approved
      resolveApproval('multi-1', true, TEST_USER);
      // Resolve the second as rejected
      resolveApproval('multi-2', false, TEST_USER);
      // Let the third time out
      vi.advanceTimersByTime(120_000);

      expect(await promise1).toBe(true);
      expect(await promise2).toBe(false);
      expect(await promise3).toBe(false);
    });

    it('auto-rejects previous approval and clears its timer when same ID is reused', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const promise1 = createApprovalRequest('overwrite-1', TEST_USER);
      const callsBefore = clearTimeoutSpy.mock.calls.length;

      const promise2 = createApprovalRequest('overwrite-1', TEST_USER);

      // The old timer should have been cleared to prevent leaks
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBefore);

      // The first promise is immediately auto-rejected (false)
      const result1 = await promise1;
      expect(result1).toBe(false);

      // resolveApproval resolves the LATEST entry
      const found = resolveApproval('overwrite-1', true, TEST_USER);
      expect(found).toBe(true);

      const result2 = await promise2;
      expect(result2).toBe(true);

      clearTimeoutSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // resolveApproval
  // -----------------------------------------------------------------------

  describe('resolveApproval', () => {
    it('returns true when the approval exists and caller is owner', async () => {
      const promise = createApprovalRequest('resolve-exists', TEST_USER);
      const found = resolveApproval('resolve-exists', true, TEST_USER);
      expect(found).toBe(true);
      await promise;
    });

    it('returns false when the approval does not exist', () => {
      const found = resolveApproval('does-not-exist', true, TEST_USER);
      expect(found).toBe(false);
    });

    it('returns false when caller is not the owner (IDOR guard)', async () => {
      createApprovalRequest('owned-by-alice', 'alice');
      // Bob tries to resolve Alice's approval
      const found = resolveApproval('owned-by-alice', true, 'bob');
      expect(found).toBe(false);
    });

    it('returns false after timeout has already cleaned up the approval', async () => {
      const promise = createApprovalRequest('resolve-after-timeout', TEST_USER);

      // Let the timeout fire
      vi.advanceTimersByTime(120_000);
      await promise;

      // Now try to resolve — it was already cleaned up
      const found = resolveApproval('resolve-after-timeout', true, TEST_USER);
      expect(found).toBe(false);
    });

    it('clears the timeout timer when resolved before timeout', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const promise = createApprovalRequest('clear-timer-1', TEST_USER);

      resolveApproval('clear-timer-1', true, TEST_USER);
      expect(clearTimeoutSpy).toHaveBeenCalled();

      await promise;
      clearTimeoutSpy.mockRestore();
    });

    it('handles approved=true correctly — promise resolves to true', async () => {
      const promise = createApprovalRequest('approve-true', TEST_USER);
      resolveApproval('approve-true', true, TEST_USER);
      expect(await promise).toBe(true);
    });

    it('handles approved=false correctly — promise resolves to false', async () => {
      const promise = createApprovalRequest('approve-false', TEST_USER);
      resolveApproval('approve-false', false, TEST_USER);
      expect(await promise).toBe(false);
    });

    it('returns false on a second resolve for the same ID', async () => {
      const promise = createApprovalRequest('double-resolve', TEST_USER);

      const first = resolveApproval('double-resolve', true, TEST_USER);
      expect(first).toBe(true);

      const second = resolveApproval('double-resolve', true, TEST_USER);
      expect(second).toBe(false);

      // The promise resolved with the first call's value
      const result = await promise;
      expect(result).toBe(true);
    });

    it('does not auto-reject after timeout if already resolved', async () => {
      const promise = createApprovalRequest('resolved-before-timeout', TEST_USER);

      resolveApproval('resolved-before-timeout', true, TEST_USER);
      const result = await promise;
      expect(result).toBe(true);

      // Advance past the timeout — should have no effect since the timer was cleared
      vi.advanceTimersByTime(120_000);

      // The promise already resolved to true, not false
      expect(result).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // generateApprovalId
  // -----------------------------------------------------------------------

  describe('generateApprovalId', () => {
    it('returns a string', () => {
      const id = generateApprovalId();
      expect(id).toBeTypeOf('string');
      expect(id).toBe('approval_test_123');
    });

    it('calls generateId with "approval" prefix', () => {
      const mockedGenerateId = vi.mocked(generateId);
      mockedGenerateId.mockClear();

      generateApprovalId();
      expect(mockedGenerateId).toHaveBeenCalledOnce();
      expect(mockedGenerateId).toHaveBeenCalledWith('approval');
    });
  });

  // -----------------------------------------------------------------------
  // Integration tests (full flow)
  // -----------------------------------------------------------------------

  describe('integration: full flow', () => {
    it('create → approve → promise resolves true', async () => {
      const approvalId = 'flow-approve';
      const promise = createApprovalRequest(approvalId, TEST_USER);

      // Simulate user clicking approve
      const resolved = resolveApproval(approvalId, true, TEST_USER);
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result).toBe(true);

      // Subsequent resolve returns false (already consumed)
      expect(resolveApproval(approvalId, true, TEST_USER)).toBe(false);
    });

    it('create → reject → promise resolves false', async () => {
      const approvalId = 'flow-reject';
      const promise = createApprovalRequest(approvalId, TEST_USER);

      // Simulate user clicking reject
      const resolved = resolveApproval(approvalId, false, TEST_USER);
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result).toBe(false);

      // Subsequent resolve returns false (already consumed)
      expect(resolveApproval(approvalId, false, TEST_USER)).toBe(false);
    });

    it('create → timeout → promise resolves false', async () => {
      const approvalId = 'flow-timeout';
      const promise = createApprovalRequest(approvalId, TEST_USER);

      // No user action — advance past the 2-minute timeout
      vi.advanceTimersByTime(120_000);

      const result = await promise;
      expect(result).toBe(false);

      // Approval is gone after timeout
      expect(resolveApproval(approvalId, true, TEST_USER)).toBe(false);
    });
  });
});
