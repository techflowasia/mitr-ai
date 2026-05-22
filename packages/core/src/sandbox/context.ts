/**
 * Sandbox context builder
 * Creates a restricted global context for sandboxed code execution
 */

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { SandboxPermissions, ResourceLimits } from './types.js';
import { DEFAULT_PERMISSIONS, DEFAULT_RESOURCE_LIMITS } from './types.js';

/**
 * Resource counter for tracking usage
 */
export class ResourceCounter {
  private networkRequests = 0;
  private fsOperations = 0;
  private readonly limits: Required<ResourceLimits>;

  constructor(limits: ResourceLimits = {}) {
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  }

  incrementNetwork(): boolean {
    if (this.networkRequests >= this.limits.maxNetworkRequests) {
      return false;
    }
    this.networkRequests++;
    return true;
  }

  incrementFs(): boolean {
    if (this.fsOperations >= this.limits.maxFsOperations) {
      return false;
    }
    this.fsOperations++;
    return true;
  }

  getStats() {
    return {
      networkRequests: this.networkRequests,
      fsOperations: this.fsOperations,
    };
  }

  reset() {
    this.networkRequests = 0;
    this.fsOperations = 0;
  }
}

/**
 * Sandbox console interface (subset of full Console)
 */
export interface SandboxConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Build a restricted console object
 */
export function buildConsole(
  onLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
): SandboxConsole {
  const formatArgs = (args: unknown[]): string => {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  };

  return {
    log: (...args: unknown[]) => onLog('info', formatArgs(args)),
    info: (...args: unknown[]) => onLog('info', formatArgs(args)),
    warn: (...args: unknown[]) => onLog('warn', formatArgs(args)),
    error: (...args: unknown[]) => onLog('error', formatArgs(args)),
    debug: (...args: unknown[]) => onLog('debug', formatArgs(args)),
  };
}

/**
 * Build restricted crypto utilities
 */
export function buildCrypto(allowed: boolean) {
  if (!allowed) {
    return undefined;
  }

  return {
    randomUUID: () => randomUUID(),
    randomBytes: (size: number) => {
      if (size > 1024) {
        throw new Error('randomBytes size exceeds limit (1024)');
      }
      return randomBytes(size);
    },
    sha256: (data: string) => {
      return createHash('sha256').update(data).digest('hex');
    },
    sha512: (data: string) => {
      return createHash('sha512').update(data).digest('hex');
    },
    /**
     * @deprecated MD5 is cryptographically broken — only retained for legacy
     * interop (e.g. ETags, gravatar). Use sha256/sha512 for integrity and
     * security. This export may be removed in a future release.
     */
    md5: (data: string) => {
      return createHash('md5').update(data).digest('hex');
    },
  };
}

/**
 * Build restricted timer functions
 */
export function buildTimers(allowed: boolean, onTimeout: () => void) {
  if (!allowed) {
    return {
      setTimeout: undefined,
      setInterval: undefined,
      clearTimeout: undefined,
      clearInterval: undefined,
      _cleanup: () => {},
    };
  }

  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();

  return {
    setTimeout: (fn: () => void, delay: number) => {
      // Limit delay to prevent hanging
      const safeDelay = Math.min(delay, 10000);
      const id = setTimeout(() => {
        timeouts.delete(id);
        try {
          fn();
        } catch (error) {
          onTimeout();
          throw error;
        }
      }, safeDelay);
      timeouts.add(id);
      return id;
    },
    setInterval: (fn: () => void, delay: number) => {
      // Limit interval to prevent tight loops
      const safeDelay = Math.max(delay, 100);
      const id = setInterval(() => {
        try {
          fn();
        } catch (error) {
          clearInterval(id);
          intervals.delete(id);
          throw error;
        }
      }, safeDelay);
      intervals.add(id);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
      timeouts.delete(id);
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      clearInterval(id);
      intervals.delete(id);
    },
    _cleanup: () => {
      timeouts.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      timeouts.clear();
      intervals.clear();
    },
  };
}

/**
 * Sandbox-realm Function stub returned from any `.constructor` access on a
 * wrapped host constructor or instance, so the
 * `URL → .constructor → .constructor('return process')()` host-realm RCE
 * chain dead-ends here instead of reaching the real host Function.
 *
 * The stub is itself a Proxy that:
 *  - returns itself for `.constructor` (so the chain stays inside the stub
 *    forever — `STUB.constructor.constructor.constructor === STUB`)
 *  - hides `.bind` / `.apply` / `.call` / `.prototype` (each of those would
 *    leak back to host Function.prototype via the stub's own prototype chain)
 *  - throws on call so dynamic-code attempts fail loudly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SANDBOX_FUNCTION_STUB: any;
{
  const stubTarget = function FunctionConstructorDisabled(): never {
    throw new Error('Function constructor is disabled in the sandbox');
  };
  SANDBOX_FUNCTION_STUB = new Proxy(stubTarget, {
    get(_target, prop) {
      if (prop === 'constructor') return SANDBOX_FUNCTION_STUB;
      if (prop === 'name') return 'FunctionConstructorDisabled';
      if (prop === Symbol.toPrimitive || prop === 'toString') {
        return () => 'function FunctionConstructorDisabled() { [disabled] }';
      }
      // Everything else — `prototype`, `bind`, `apply`, `call`, static slots,
      // arbitrary symbols — is blocked. They would otherwise leak host realm.
      return undefined;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
    apply() {
      throw new Error('Function constructor is disabled in the sandbox');
    },
    construct() {
      throw new Error('Function constructor is disabled in the sandbox');
    },
  });
}

/**
 * Wrap a host-realm constructor so the sandbox cannot walk its prototype chain
 * into the host Function constructor. Both `Ctor.constructor` and
 * `(new Ctor(...)).constructor` resolve to {@link SANDBOX_FUNCTION_STUB}.
 *
 * Without this wrapper, an injected host constructor like `URL` would let any
 * sandbox code run `new URL('http://x').constructor.constructor('return process')()`
 * and obtain HOST-realm code execution — even with `codeGeneration.strings:false`,
 * which only governs the VM realm's own Function constructor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapHostConstructor<T extends abstract new (...args: any[]) => any>(HostCtor: T): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      if (prop === 'constructor') return SANDBOX_FUNCTION_STUB;
      return Reflect.get(target, prop, receiver);
    },
    construct(target, args, newTarget) {
      const instance = Reflect.construct(
        target as unknown as new (...a: unknown[]) => unknown,
        args as unknown[],
        newTarget === wrapped ? (target as unknown as new (...a: unknown[]) => unknown) : newTarget
      );
      return new Proxy(instance as object, {
        // For host classes with private internal slots (URL, Response, Headers,
        // TextEncoder…), accessor getters require `this` to be the real
        // instance, NOT the wrapping Proxy. Forward the real target as
        // receiver. The Proxy's only job here is to block `.constructor`.
        get(t, p) {
          if (p === 'constructor') return SANDBOX_FUNCTION_STUB;
          const v = Reflect.get(t, p, t);
          if (typeof v === 'function') {
            return v.bind(t);
          }
          return v;
        },
      }) as unknown as object;
    },
  };
  const wrapped = new Proxy(HostCtor, handler);
  return wrapped;
}

/**
 * Wrap a host-realm function (e.g. bound `fetch`) so `.constructor` resolves
 * to the sandbox stub instead of host Function. The returned function value
 * is still callable normally.
 */
function wrapHostFunction<F extends (...args: never[]) => unknown>(hostFn: F): F {
  return new Proxy(hostFn, {
    get(target, prop, receiver) {
      if (prop === 'constructor') return SANDBOX_FUNCTION_STUB;
      return Reflect.get(target, prop, receiver);
    },
  }) as F;
}

/**
 * Build the sandbox global context
 */
export function buildSandboxContext(
  permissions: SandboxPermissions = {},
  limits: ResourceLimits = {},
  customGlobals: Record<string, unknown> = {},
  onLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void = () => {}
): { context: Record<string, unknown>; cleanup: () => void } {
  const perms = { ...DEFAULT_PERMISSIONS, ...permissions };
  const resourceCounter = new ResourceCounter(limits);

  // Build timer utilities
  const timers = buildTimers(perms.timers, () => {});

  // Build the context object.
  //
  // CRITICAL — host vs VM realm:
  // `vm.createContext()` gives the sandbox its OWN V8 built-ins (Object, Array,
  // Function, String, Number, Boolean, Date, RegExp, Error and subclasses, JSON,
  // Math, Promise, Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect, BigInt,
  // ArrayBuffer, DataView, all typed arrays). Those VM-realm constructors are
  // SAFE: walking `.constructor.constructor` from a VM-realm value lands on the
  // VM-realm Function constructor, which compiles strings inside the VM context
  // (and is blocked by `codeGeneration.strings:false`).
  //
  // HOST-realm constructors injected here are NOT safe — `.constructor.constructor`
  // from a host value lands on the host Function constructor, which compiles
  // strings in the HOST realm with full `process` access. So we must:
  //   1. Not inject anything V8 already provides (redundant escape surface).
  //   2. Wrap the host constructors we DO need to expose (URL, URLSearchParams,
  //      TextEncoder, TextDecoder, and the network constructors) so their
  //      `.constructor` returns a sandbox stub instead of host Function.
  const context: Record<string, unknown> = {
    console: buildConsole(onLog),
    // Stateless coercion utilities — pure functions with no prototype chain leak.
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,

    // Node-only host constructors that V8's per-context globals do NOT provide.
    // Each is Proxy-wrapped so `instance.constructor.constructor` resolves to a
    // sandbox-realm throwing stub instead of the host Function constructor.
    URL: wrapHostConstructor(URL),
    URLSearchParams: wrapHostConstructor(URLSearchParams),
    TextEncoder: wrapHostConstructor(TextEncoder),
    TextDecoder: wrapHostConstructor(TextDecoder),

    // Timers (if allowed)
    ...(perms.timers
      ? {
          setTimeout: timers.setTimeout,
          setInterval: timers.setInterval,
          clearTimeout: timers.clearTimeout,
          clearInterval: timers.clearInterval,
        }
      : {}),

    // Crypto utilities (if allowed)
    ...(perms.crypto ? { crypto: buildCrypto(true) } : {}),

    // Network utilities (if allowed). `fetch` is wrapped so the returned host
    // Response's `.constructor.constructor` cannot be walked into host Function.
    // The constructors themselves are wrapped for the same reason.
    ...(perms.network
      ? {
          fetch: wrapHostFunction(globalThis.fetch.bind(globalThis)),
          Response: wrapHostConstructor(globalThis.Response),
          Request: wrapHostConstructor(globalThis.Request),
          Headers: wrapHostConstructor(globalThis.Headers),
        }
      : {}),

    // Custom globals
    ...customGlobals,

    // Explicitly undefined dangerous globals
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    globalThis: undefined,
    eval: undefined,
    Function: undefined, // Prevent dynamic code execution
    Atomics: undefined, // Prevent shared memory attacks
    SharedArrayBuffer: undefined, // Prevent shared memory attacks
  };

  // NOTE: Prototype freezing is done INSIDE the VM context via SANDBOX_INIT_CODE
  // (see below). Doing Object.freeze(Object.prototype) here would freeze the
  // HOST process prototypes, breaking the entire Node.js runtime.
  // However, Object.defineProperty on the context object is safe — createContext
  // preserves property descriptors, so these become non-writable VM globals.
  const dangerousKeys = [
    'process',
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
    'global',
    'globalThis',
    'eval',
    'Function',
    'Atomics',
    'SharedArrayBuffer',
    'Proxy',
    'Reflect',
  ];
  for (const key of dangerousKeys) {
    Object.defineProperty(context, key, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  // Cleanup function
  const cleanup = () => {
    timers._cleanup();
    resourceCounter.reset();
  };

  return { context, cleanup };
}

/**
 * Validate code before execution
 * Basic static analysis to prevent obvious attacks
 *
 * NOTE: Prototype freezing via Object.freeze() is NOT used because buildSandboxContext
 * passes the HOST's Object/Array/etc. as sandbox globals. Freezing Object.prototype
 * inside the VM would freeze the HOST's prototype (since Object === host Object).
 * Instead, the sandbox relies on these layered defenses:
 *   1. validateCode() — regex-based static analysis blocks obvious attack patterns
 *   2. codeGeneration: { strings: false } — V8-level block on eval/Function constructor,
 *      which prevents the constructor chain escape [].constructor.constructor('return X')()
 *   3. Object.defineProperty on dangerous keys — makes process/require/etc. non-writable
 *   4. Explicit undefined for dangerous globals in the context object
 *
 * Patterns are centralized in code-validator.ts (single source of truth).
 */
export { validateToolCode as validateCode } from './code-validator.js';
