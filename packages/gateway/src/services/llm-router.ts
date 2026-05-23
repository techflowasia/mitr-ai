/**
 * LLMRouter — gateway implementation of the ILLMRouter contract from core.
 *
 * This is a thin facade over the existing scattered helpers
 * (`resolveProviderAndModel` in agent-runner-utils, `resolveContextWindow`
 * et al. in agent-cache, `calculateExecutionCost`). The functions remain
 * in their current homes because they have other reasonable callers
 * (chat layer, tests, etc.); the router gives every NEW caller a single
 * named import path so runtimes consume a typed capability surface
 * instead of stitching together private helpers.
 *
 * Migration policy: new code should `import { getLLMRouter } from './llm-router.js'`
 * and call methods on it. Old call sites are not auto-migrated — they get
 * cleaned up as their files are touched for other reasons.
 */

import type { ILLMRouter } from '@ownpilot/core';
import { setLLMRouter, getLLMRouter as coreGetLLMRouter } from '@ownpilot/core';
import { resolveProviderAndModel, calculateExecutionCost } from './agent-runner-utils.js';
import {
  resolveContextWindow,
  resolveMaxOutput,
  computeMemoryMaxTokens,
} from '../routes/agent-cache.js';

/** Gateway-side LLMRouter implementation — thin facade over scattered helpers. */
export const llmRouter: ILLMRouter = {
  pick: (opts) =>
    resolveProviderAndModel(
      opts.explicitProvider,
      opts.explicitModel,
      opts.process ?? 'pulse',
      opts.errorContext
    ),
  getContextWindow: resolveContextWindow,
  getMaxOutput: resolveMaxOutput,
  computeMemoryMaxTokens,
  calculateCost: calculateExecutionCost,
};

/**
 * Install the gateway LLMRouter into the core singleton + service registry.
 * Called once at gateway startup. Idempotent (setLLMRouter checks
 * registry.has() before re-registering).
 */
export function installLLMRouter(): void {
  setLLMRouter(llmRouter);
}

/**
 * Get the singleton LLM router.
 *
 * @deprecated Prefer `import { getLLMRouter } from '@ownpilot/core'`. This
 * gateway-side re-export exists only for backward compatibility with
 * callers wired up before the core promotion. Both resolve to the same
 * singleton.
 */
export function getLLMRouter(): ILLMRouter {
  return coreGetLLMRouter();
}
