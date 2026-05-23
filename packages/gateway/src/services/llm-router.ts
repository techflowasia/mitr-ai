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
import { resolveProviderAndModel, calculateExecutionCost } from './agent-runner-utils.js';
import {
  resolveContextWindow,
  resolveMaxOutput,
  computeMemoryMaxTokens,
} from '../routes/agent-cache.js';

const llmRouter: ILLMRouter = {
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
 * Get the singleton LLM router. Stateless — the same instance is returned
 * across the process. Mock by replacing the named export in vitest:
 *
 *   vi.mock('./llm-router.js', () => ({
 *     getLLMRouter: () => ({ pick: vi.fn(), getContextWindow: vi.fn(), ... })
 *   }))
 */
export function getLLMRouter(): ILLMRouter {
  return llmRouter;
}
