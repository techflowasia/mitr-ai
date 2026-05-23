/**
 * LLMRouter — unified contract for LLM provider/model selection,
 * context window resolution, and cost calculation.
 *
 * Why this exists:
 *   Before this contract, every runtime (Claw, Chat, Soul Heartbeat,
 *   Workflow) imported a different combination of helpers — some from
 *   `agent-runner-utils.ts`, some from `agent-cache.ts`, some from
 *   `routes/settings.ts`. The same conceptual question ("how does THIS
 *   runtime pick an LLM and figure out its limits?") had three different
 *   answers depending on where you looked.
 *
 *   This module declares the single capability surface for "LLM access"
 *   so runtimes only ever consume one named interface. Implementation
 *   stays in the gateway package (where the routing + DB-backed config
 *   live); only the contract lives here in core.
 */

/** Token usage shape returned by any LLM provider. */
export interface LLMTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

/** Options for picking a provider+model. */
export interface LLMPickOptions {
  /** When set together with explicitModel, used directly without waterfall. */
  explicitProvider?: string;
  explicitModel?: string;
  /**
   * The runtime kind asking. Determines which per-process default applies
   * when explicit provider/model is omitted: 'pulse' = autonomous (Claw /
   * Soul Heartbeat / Pulse), 'chat' = interactive conversation.
   */
  process?: 'pulse' | 'chat';
  /** Free-form label included in the "no provider configured" error message. */
  errorContext?: string;
}

/** Result of LLMRouter.pick(). */
export interface LLMResolvedModel {
  provider: string;
  model: string;
}

/** Inputs for the memory-budget calculation. */
export interface LLMMemoryBudgetOptions {
  /** Total context window of the chosen model (tokens). */
  ctxWindow: number;
  /** Estimated tokens consumed by the system prompt. */
  systemPromptTokens: number;
  /** Reserved tokens for the model's output. */
  outputBuffer: number;
  /**
   * Tokens reserved for dynamic mid-conversation injection (memories, goals,
   * etc.). Defaults to min(8192, ctxWindow * 0.25) when not provided.
   * Autonomous runners typically pass 0 because they don't go through the
   * chat injection middleware.
   */
  dynamicInjectionReserve?: number;
}

/**
 * The single capability contract for LLM access. Every runtime that needs
 * to pick a model, ask "how big is its context window?", or calculate cost
 * should consume this interface. Direct imports of `resolveProviderAndModel`,
 * `resolveContextWindow`, `calculateExecutionCost`, etc. are now legacy and
 * should be migrated as touched.
 */
export interface ILLMRouter {
  /**
   * Resolve provider+model via waterfall:
   *   explicit args -> per-process default (settings) -> system default
   * Throws if no provider/model can be resolved.
   */
  pick(opts: LLMPickOptions): Promise<LLMResolvedModel>;

  /**
   * Look up the context window (in tokens) for a provider+model.
   * Honors the user override when supplied. Falls back to a safe default
   * when the model isn't in the local provider config.
   */
  getContextWindow(provider: string, model: string, userOverride?: number): number;

  /** Look up the max output tokens for a provider+model. */
  getMaxOutput(provider: string, model: string): number;

  /**
   * Given a context window + system prompt size + output buffer, compute
   * how many tokens are safe to spend on memory (i.e. conversation history
   * + dynamic injection). Bounded by `ctxWindow * 0.75` and a fixed
   * 1024-token safety margin.
   */
  computeMemoryMaxTokens(opts: LLMMemoryBudgetOptions): number;

  /** Convert token usage to a USD cost figure. Returns 0 when usage is null. */
  calculateCost(provider: string, model: string, usage?: LLMTokenUsage | null): number;
}
