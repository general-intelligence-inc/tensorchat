/**
 * In-memory stub of the `tc` runtime for pre-flight smoke testing.
 *
 * The real runtime (src/miniapps/runtime/tc.ts) only exists as a string
 * that gets inlined into the WebView's index.html. We CAN'T load it here
 * — it depends on DOM globals and `requestAnimationFrame`. Instead, this
 * stub provides the same SURFACE (same function names, same primitive
 * set) but every component factory just returns a plain descriptor
 * object tagged with `__tc`. The smoke test executes the program
 * against this stub to verify:
 *
 *   1. The program parses and runs at top level without throwing
 *   2. It calls tc.mount() with a function argument
 *   3. The mount render fn, when invoked once, produces a valid tree
 *   4. Every node in that tree is a known primitive with valid props
 *
 * Key design decisions:
 *
 * - `tc.mount` CAPTURES the render fn but does not invoke it inline.
 *   The smoke test invokes it exactly once after the IIFE returns.
 *   This separates "top-level threw" from "render threw" errors.
 *
 * - `tc.state` is a Proxy that records writes AND reads. The reads are
 *   captured during the render invocation so the retry prompt can tell
 *   the model which keys its render fn actually touched.
 *
 * - `tc.save` / `tc.load` / `tc.clear` are no-ops that log the access.
 *   The stub has no real storage so `tc.load` always returns null.
 *   This matches a "first run on a fresh device" perfectly.
 *
 * - The descriptor factory DOES NOT validate props — validation is
 *   separate (src/miniapps/validator/schema.ts:validateTree). Keeping
 *   them separate means we can capture bad-but-descriptor-shaped
 *   output and surface the validation errors uniformly regardless of
 *   whether they came from a stub run or a live render.
 */

/**
 * Snapshot of everything the stub observed during a single smoke run.
 * Drives the ExecutionTrace that eventually lands in retry prompts.
 */
export interface TcStubObservation {
  mountCalled: boolean;
  mountArgIsFunction: boolean;
  /** If mount was called, the captured render fn (uninvoked). */
  mountRenderFn: (() => unknown) | null;
  /** State keys assigned during top-level eval, before mount invocation. */
  topLevelStateWrites: string[];
  /** State keys read during the (single) render fn invocation. */
  renderStateReads: string[];
  /** Keys the program tried to save via tc.save. */
  topLevelSaves: Array<{ key: string }>;
  /** Keys the program tried to load via tc.load. */
  loadCalls: Array<{ key: string }>;
}

export interface CreatedTcStub {
  /** The `tc` object to inject as the program's only global. */
  stub: Record<string, unknown>;
  /** Accessor to the mutable observation record. */
  getObservation: () => TcStubObservation;
  /**
   * Toggle render-mode bookkeeping. Between the top-level eval and
   * invoking the captured render fn, the smoke test calls this to
   * transition from "top level" to "render" — state reads that
   * happen from now on go into `renderStateReads` instead of being
   * silently dropped.
   */
  enterRenderMode: () => void;
}

/**
 * Build a fresh stub. Each smoke-test invocation should create its own
 * stub — never share state between runs.
 */
export function createTcStub(): CreatedTcStub {
  const observation: TcStubObservation = {
    mountCalled: false,
    mountArgIsFunction: false,
    mountRenderFn: null,
    topLevelStateWrites: [],
    renderStateReads: [],
    topLevelSaves: [],
    loadCalls: [],
  };

  let phase: "top-level" | "render" = "top-level";

  // Proxy-backed state bag. Records writes (always) and reads (render
  // phase only). Uses a plain object as target so the model's
  // `Object.keys(tc.state)` / `for (var k in tc.state)` patterns work.
  const stateTarget: Record<string, unknown> = {};
  const state = new Proxy(stateTarget, {
    set(target, key, value) {
      if (typeof key === "string") {
        if (phase === "top-level" && !observation.topLevelStateWrites.includes(key)) {
          observation.topLevelStateWrites.push(key);
        }
      }
      target[key as string] = value;
      return true;
    },
    get(target, key) {
      if (typeof key === "string" && phase === "render") {
        if (!observation.renderStateReads.includes(key)) {
          observation.renderStateReads.push(key);
        }
      }
      return target[key as string];
    },
    deleteProperty(target, key) {
      delete target[key as string];
      return true;
    },
  });

  /**
   * Build a descriptor factory for a primitive. The real runtime
   * accepts either `(props)` or `(props, children)`; the stub mirrors
   * that signature and always emits a `{ __tc: type, ...props }`
   * object so validators can walk it identically.
   */
  function makeDescriptor(type: string) {
    return function (props?: unknown, children?: unknown): Record<string, unknown> {
      const safe: Record<string, unknown> =
        props && typeof props === "object" ? { ...(props as Record<string, unknown>) } : {};
      // Children can be supplied as the second positional OR inside props.
      if (children !== undefined) safe.children = children;
      safe.__tc = type;
      return safe;
    };
  }

  const baseStub: Record<string, unknown> = {
    state,

    // 12 primitives — kept in lockstep with src/miniapps/validator/schema.ts
    heading: makeDescriptor("heading"),
    text: makeDescriptor("text"),
    display: makeDescriptor("display"),
    button: makeDescriptor("button"),
    input: makeDescriptor("input"),
    row: makeDescriptor("row"),
    column: makeDescriptor("column"),
    grid: makeDescriptor("grid"),
    card: makeDescriptor("card"),
    list: makeDescriptor("list"),
    toggle: makeDescriptor("toggle"),
    slider: makeDescriptor("slider"),

    // Mount captures the render fn. Does NOT invoke it — the smoke
    // test does that under its own try/catch after the IIFE returns.
    mount(renderFn: unknown): void {
      observation.mountCalled = true;
      if (typeof renderFn === "function") {
        observation.mountArgIsFunction = true;
        observation.mountRenderFn = renderFn as () => unknown;
      }
    },

    // Storage: no-op writes + null reads. The program can't depend on
    // persisted values for its FIRST render (the stub always returns
    // null from load), which matches "first run on a fresh device".
    save(key: unknown, _value: unknown): boolean {
      if (typeof key === "string") {
        observation.topLevelSaves.push({ key });
      }
      return true;
    },
    load(key: unknown): null {
      if (typeof key === "string") {
        observation.loadCalls.push({ key });
      }
      return null;
    },
    clear(_key?: unknown): void {
      // No-op.
    },
  };

  // Wrap the stub in a Proxy so UNKNOWN property access produces a
  // descriptor factory instead of throwing `TypeError: tc.X is not a
  // function`. This turns "model called tc.table(...)" into a render
  // tree that validateTree will flag as `schema.unknown_component`,
  // giving the model a crisp "tc.table doesn't exist; the 12
  // primitives are …" error instead of a generic TypeError.
  //
  // Only the descriptor-producing primitives go through this fallback
  // — `state`, `mount`, `save`, `load`, `clear` are explicit and
  // Proxy access always resolves them via the target.
  const stub = new Proxy(baseStub, {
    get(target, key: string | symbol): unknown {
      if (key in target) return target[key as string];
      if (typeof key !== "string") return undefined;
      // Unknown property on tc — return a descriptor factory that
      // tags the output with the attempted name. validateTree will
      // see an unknown component and produce a schema.unknown_component
      // issue for it.
      return makeDescriptor(key);
    },
  });

  return {
    stub,
    getObservation: () => observation,
    enterRenderMode: () => {
      phase = "render";
    },
  };
}
