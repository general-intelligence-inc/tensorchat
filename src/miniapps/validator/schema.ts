/**
 * Component prop-schema registry for the tc runtime.
 *
 * This is the SINGLE source of truth for what props each tc primitive
 * accepts. Both the smoke-test validator (Node-side, pre-write) and
 * the in-browser tc runtime (live rendering) import this registry so
 * error messages use identical language regardless of whether the
 * failure was caught before or after the disk write.
 *
 * For small-model reliability, this is the single biggest lever:
 *
 *   - The validator catches typos like `secondary` → `primary` and
 *     surfaces a "did you mean" suggestion the model can act on.
 *   - The validator catches type mismatches like onInput being a
 *     string (common when the model wraps a handler in quotes by
 *     mistake).
 *   - The validator catches unknown component types from models that
 *     invent primitives like `tc.table` or `tc.modal` that don't exist.
 *
 * IMPORTANT: when editing this file, keep the prop names in sync with
 *   src/miniapps/runtime/tc.ts           (the actual runtime)
 *   src/agent/miniAppAgent.ts            (the system-prompt docs)
 * If any of those three drift out of sync, the model will see
 * conflicting information and degrade.
 */

import type { ValidationIssue } from "./types";

/**
 * One of the primitive value types a component prop can accept.
 *
 * - "string" / "number" / "boolean" — primitive JS types, matched with typeof
 * - "function" — matched with typeof === "function"
 * - "enum" — must match one of the values in `enumValues`
 * - "children" — must be a descriptor or array of descriptors (for containers)
 * - "any" — accepts any value (used rarely, for props like `items` that are
 *   passed through to a user-supplied render fn)
 */
export type PropType =
  | "string"
  | "number"
  | "boolean"
  | "function"
  | "enum"
  | "children"
  | "any";

export interface PropSpec {
  /** Accepted type(s). Use an array for unions like `["string", "number"]`. */
  type: PropType | PropType[];
  /** If true, the prop must be present and non-null. Default: false. */
  required?: boolean;
  /** For enum types: the list of accepted string values. */
  enumValues?: string[];
  /** Short human-readable description — embedded in error suggestions. */
  description?: string;
}

export interface ComponentSpec {
  /** Name matching `tc.<name>` — e.g. "button", "column". */
  name: string;
  /** Full prop schema keyed by prop name. */
  props: Record<string, PropSpec>;
  /**
   * Whether this component accepts children. Containers (row/column/grid/card)
   * do; leaves (button/input/heading) don't.
   */
  childrenAllowed: boolean;
  /**
   * Example props JSON string used inside error suggestions.
   * e.g. '{ label: "Tap", onClick: function() {}, primary: true }'
   */
  examplePropsJson: string;
}

/**
 * Alias map for "did you mean" suggestions. Each entry maps a
 * commonly-mistaken prop name to the real one. These come from
 * observed 2B-model failures — the right-hand side is the ACTUAL
 * prop, the left-hand side is the typo the model emitted.
 */
const PROP_ALIASES: Record<string, string> = {
  // Buttons — small models confuse React conventions with ours
  onPress: "onClick",
  onTap: "onClick",
  secondary: "primary",
  variant: "primary",
  // Headings — models emit `value` or `title` instead of `text`
  value: "text",
  title: "text",
  content: "text",
  // Inputs
  onChange: "onInput",
  onType: "onInput",
  defaultValue: "value",
  // Toggles
  checked: "value",
  on: "value",
  // Sliders
  min_value: "min",
  max_value: "max",
  // Containers
  gap_size: "gap",
  spacing: "gap",
};

/**
 * Props that should be DROPPED entirely rather than renamed. These
 * are React/Tailwind/CSS-in-JS props that the tc runtime handles
 * automatically via the baked-in theme — passing them does nothing
 * in production AND produces a crisp "remove this prop" error here.
 */
const PROPS_TO_REMOVE = new Set([
  "style",
  "className",
  "class",
  "sx",
  "tw",
  "css",
]);

/**
 * THE registry. One entry per tc primitive. Prop names and types MUST
 * match the actual runtime implementation at src/miniapps/runtime/tc.ts.
 */
export const COMPONENT_REGISTRY: Record<string, ComponentSpec> = {
  heading: {
    name: "heading",
    props: {
      text: { type: "string", required: true },
      level: { type: "enum", enumValues: ["lg", "sm"] },
    },
    childrenAllowed: false,
    examplePropsJson: '{ text: "Hello", level: "lg" }',
  },

  text: {
    name: "text",
    props: {
      text: { type: "string", required: true },
      dim: { type: "boolean" },
    },
    childrenAllowed: false,
    examplePropsJson: '{ text: "Some body text", dim: true }',
  },

  display: {
    name: "display",
    props: {
      text: { type: ["string", "number"], required: true },
      size: { type: "enum", enumValues: ["lg", "sm"] },
    },
    childrenAllowed: false,
    examplePropsJson: '{ text: "42", size: "lg" }',
  },

  button: {
    name: "button",
    props: {
      label: { type: "string", required: true },
      onClick: { type: "function", required: true },
      primary: { type: "boolean" },
      danger: { type: "boolean" },
      disabled: { type: "boolean" },
    },
    childrenAllowed: false,
    examplePropsJson:
      '{ label: "Tap", onClick: function() {}, primary: true }',
  },

  input: {
    name: "input",
    props: {
      value: { type: ["string", "number"] },
      onInput: { type: "function", required: true },
      placeholder: { type: "string" },
      type: { type: "enum", enumValues: ["text", "number"] },
    },
    childrenAllowed: false,
    examplePropsJson:
      '{ value: "", onInput: function(e) { tc.state.x = e.target.value; } }',
  },

  row: {
    name: "row",
    props: {
      gap: { type: "number" },
      align: { type: "enum", enumValues: ["start", "center", "end", "stretch"] },
      justify: {
        type: "enum",
        enumValues: ["start", "center", "end", "between", "around"],
      },
      padding: { type: "number" },
      wrap: { type: "boolean" },
    },
    childrenAllowed: true,
    examplePropsJson: '{ gap: 12, align: "center" }',
  },

  column: {
    name: "column",
    props: {
      gap: { type: "number" },
      align: { type: "enum", enumValues: ["start", "center", "end", "stretch"] },
      justify: {
        type: "enum",
        enumValues: ["start", "center", "end", "between", "around"],
      },
      padding: { type: "number" },
    },
    childrenAllowed: true,
    examplePropsJson: '{ gap: 16, padding: 24 }',
  },

  grid: {
    name: "grid",
    props: {
      columns: { type: "number", required: true },
      gap: { type: "number" },
    },
    childrenAllowed: true,
    examplePropsJson: '{ columns: 4, gap: 8 }',
  },

  card: {
    name: "card",
    props: {
      padding: { type: "number" },
      // Cards routinely contain multiple children and small models
      // reach for `gap` by reflex. Accept it as a convenience — the
      // runtime applies it as flex-column gap on the card element
      // directly, so `tc.card({ gap: 12 }, [...])` behaves like a
      // column with a border.
      gap: { type: "number" },
    },
    childrenAllowed: true,
    examplePropsJson: '{ padding: 16, gap: 12 }',
  },

  list: {
    name: "list",
    props: {
      items: { type: "any", required: true },
      render: { type: "function", required: true },
      emptyText: { type: "string" },
    },
    childrenAllowed: false,
    examplePropsJson:
      '{ items: [], render: function(item) { return tc.text({ text: item }); } }',
  },

  toggle: {
    name: "toggle",
    props: {
      label: { type: "string" },
      value: { type: "boolean", required: true },
      onChange: { type: "function", required: true },
    },
    childrenAllowed: false,
    examplePropsJson:
      '{ label: "Dark mode", value: true, onChange: function(v) {} }',
  },

  slider: {
    name: "slider",
    props: {
      label: { type: "string" },
      value: { type: "number", required: true },
      min: { type: "number", required: true },
      max: { type: "number", required: true },
      step: { type: "number" },
      onChange: { type: "function", required: true },
    },
    childrenAllowed: false,
    examplePropsJson:
      '{ value: 50, min: 0, max: 100, onChange: function(e, v) {} }',
  },
};

/** All known component names as a plain array — used in error messages. */
export const COMPONENT_NAMES: readonly string[] = Object.keys(
  COMPONENT_REGISTRY,
);

/** Comma-separated list for error messages. */
const COMPONENT_LIST_STR = COMPONENT_NAMES.join(", ");

/**
 * Test if a value satisfies a single PropType. Function types match
 * via typeof; "children" accepts a descriptor or an array of them.
 */
function matchesType(value: unknown, type: PropType): boolean {
  if (type === "any") return true;
  if (type === "children") {
    if (value == null) return true;
    if (Array.isArray(value)) return true;
    return typeof value === "object" && value !== null && "__tc" in (value as object);
  }
  if (type === "function") return typeof value === "function";
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "enum") return typeof value === "string";
  return false;
}

function typeListToString(type: PropType | PropType[]): string {
  const types = Array.isArray(type) ? type : [type];
  return types.join(" | ");
}

/**
 * Validate the props passed to a single tc.<component> call.
 *
 * Returns a list of validation issues (empty list = valid). Issues are
 * model-actionable: each carries a short suggestion for how to fix it.
 */
export function validateProps(
  componentName: string,
  props: Record<string, unknown> | null | undefined,
  treePath: string = componentName,
): ValidationIssue[] {
  const spec = COMPONENT_REGISTRY[componentName];
  if (!spec) {
    return [
      {
        code: "schema.unknown_component",
        message:
          `Unknown component type \`tc.${componentName}\`. The ${COMPONENT_NAMES.length} ` +
          `supported primitives are: ${COMPONENT_LIST_STR}.`,
        location: { treePath },
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  const safeProps: Record<string, unknown> =
    props && typeof props === "object" ? props : {};

  // Check unknown prop names (excluding "children" which every call can carry).
  for (const propName of Object.keys(safeProps)) {
    if (propName === "children" || propName === "__tc") continue;
    // Also skip the path-threading private field we set in tc.ts so
    // live runtime validation doesn't trip on its own bookkeeping.
    if (propName === "__tc_path") continue;
    if (spec.props[propName]) continue;

    // Three error shapes:
    //   (a) prop is in PROPS_TO_REMOVE → "delete this prop" message
    //   (b) prop has an alias → "did you mean X?" message
    //   (c) neither → generic "unknown prop, valid props are X" message
    if (PROPS_TO_REMOVE.has(propName)) {
      issues.push({
        code: "schema.unknown_prop",
        message:
          `tc.${componentName} at ${treePath}: the \`${propName}\` prop is ` +
          `not supported — the tc runtime handles all styling via its ` +
          `baked-in theme. DELETE the \`${propName}\` prop from this call. ` +
          `Valid props: ${Object.keys(spec.props).join(", ")}.`,
        location: { treePath },
        suggestions: [`Delete the \`${propName}\` prop entirely.`],
      });
      continue;
    }

    const alias = PROP_ALIASES[propName];
    const issue: ValidationIssue = {
      code: "schema.unknown_prop",
      message: alias
        ? `tc.${componentName} at ${treePath}: unknown prop \`${propName}\`. ` +
          `Did you mean \`${alias}\`? Valid props: ${Object.keys(spec.props).join(", ")}.`
        : `tc.${componentName} at ${treePath}: unknown prop \`${propName}\`. ` +
          `Valid props: ${Object.keys(spec.props).join(", ")}.`,
      location: { treePath },
    };
    if (alias) issue.suggestions = [`Use \`${alias}\` instead of \`${propName}\`.`];
    issues.push(issue);
  }

  // Check required props and type-match present props.
  for (const [propName, propSpec] of Object.entries(spec.props)) {
    const value = safeProps[propName];
    const present = value !== undefined && value !== null;

    if (!present) {
      if (propSpec.required) {
        issues.push({
          code: "schema.missing_required_prop",
          message:
            `tc.${componentName} at ${treePath}: missing required prop ` +
            `\`${propName}\` (${typeListToString(propSpec.type)}). ` +
            `Example: ${spec.examplePropsJson}`,
          location: { treePath },
        });
      }
      continue;
    }

    // Type-check (union-aware).
    const types = Array.isArray(propSpec.type) ? propSpec.type : [propSpec.type];
    const matches = types.some((t) => matchesType(value, t));
    if (!matches) {
      issues.push({
        code: "schema.wrong_prop_type",
        message:
          `tc.${componentName} at ${treePath}: prop \`${propName}\` must be ` +
          `${typeListToString(propSpec.type)}, got ${typeof value}.`,
        location: { treePath },
      });
      continue;
    }

    // Enum value check.
    if (
      (Array.isArray(propSpec.type) ? propSpec.type.includes("enum") : propSpec.type === "enum") &&
      propSpec.enumValues &&
      !propSpec.enumValues.includes(String(value))
    ) {
      issues.push({
        code: "schema.invalid_enum_value",
        message:
          `tc.${componentName} at ${treePath}: prop \`${propName}\` got ` +
          `\`${String(value)}\`, expected one of: ${propSpec.enumValues.join(", ")}.`,
        location: { treePath },
      });
    }
  }

  // Children check.
  const childrenValue = safeProps.children;
  if (childrenValue !== undefined && !spec.childrenAllowed) {
    issues.push({
      code: "schema.children_not_allowed",
      message:
        `tc.${componentName} at ${treePath}: this primitive does not accept ` +
        `children. Use a container (tc.row / tc.column / tc.grid / tc.card) ` +
        `if you need to group components.`,
      location: { treePath },
    });
  }

  return issues;
}

/**
 * Walk a descriptor tree (the return value of a tc.* call) and collect
 * validation issues at every node. Used by the smoke test to verify
 * that the rendered tree is structurally valid BEFORE the program is
 * written to disk.
 *
 * Caps at 500 visited nodes to avoid runaway traversal on degenerate
 * programs (e.g. a circular tree — which shouldn't happen since
 * descriptors are plain objects, but defensive bounding is cheap).
 */
export function validateTree(
  node: unknown,
  path: string = "root",
  visited: { count: number } = { count: 0 },
): ValidationIssue[] {
  if (visited.count >= 500) return [];
  visited.count++;

  if (node == null) return [];

  // Arrays of children — recurse into each.
  if (Array.isArray(node)) {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < node.length; i++) {
      issues.push(...validateTree(node[i], `${path}[${i}]`, visited));
    }
    return issues;
  }

  // Primitives (strings, numbers) — valid leaf content for things like text.
  if (typeof node !== "object") return [];

  // Descriptor object — must have __tc marker.
  const obj = node as Record<string, unknown>;
  const tcType = obj.__tc;
  if (typeof tcType !== "string") {
    return [
      {
        code: "smoke.render_invalid_tree",
        message:
          `Render tree at ${path} contained a plain object without a ` +
          `component type. Every child must be a tc.* component.`,
        location: { treePath: path },
      },
    ];
  }

  const nextPath = `${path}.${tcType}`;
  const issues = validateProps(tcType, obj, nextPath);

  // Recurse into children.
  const children = obj.children;
  if (children !== undefined) {
    issues.push(...validateTree(children, `${nextPath}.children`, visited));
  }

  return issues;
}

/**
 * Collect the unique set of component types used in a tree. Used by
 * the ExecutionTrace to give the retry prompt visibility into which
 * primitives the model actually composed.
 */
export function collectComponentTypes(
  node: unknown,
  out: Set<string> = new Set(),
  visited: { count: number } = { count: 0 },
): Set<string> {
  if (visited.count >= 500) return out;
  visited.count++;
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectComponentTypes(child, out, visited);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj.__tc === "string") out.add(obj.__tc);
  if (obj.children !== undefined) {
    collectComponentTypes(obj.children, out, visited);
  }
  return out;
}
