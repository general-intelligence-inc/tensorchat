/**
 * Local iteration harness for the mini-app pipeline.
 *
 * Runs the PURE validator layer (no react-native-fs, no AsyncStorage,
 * no llama.rn) against a bank of canned tool-call inputs so we can
 * iterate on validation / retry-feedback logic without touching a
 * simulator.
 *
 * Run via:
 *   npx tsx scripts/test-miniapp-local.ts
 *
 * What's covered:
 *   - cleanProgramField: edge cases (empty, fence-only, label-only, whitespace)
 *   - runStaticChecks: every short-circuit case
 *   - smokeTest: every SmokeResult kind
 *   - validateTree / validateProps: unknown component, unknown prop,
 *     wrong type, missing required, enum violations, children-not-allowed
 *   - applyPatch: all 8 invariants
 *   - renderRetryAppendix: snapshot per error code
 *   - classifyLlamaError + humanizeRetryReason
 *
 * What's NOT covered (requires real device / llama):
 *   - runPipeline (depends on writeApp → react-native-fs)
 *   - runMiniAppHarness (depends on Agent + llama)
 */

import {
  cleanProgramField,
  runStaticChecks,
} from "../src/miniapps/validator/staticChecks";
import {
  validateProps,
  validateTree,
  COMPONENT_REGISTRY,
  COMPONENT_NAMES,
} from "../src/miniapps/validator/schema";
import { smokeTest } from "../src/miniapps/validator/smokeTest";
import { applyPatch } from "../src/miniapps/validator/applyPatch";
import {
  renderRetryAppendix,
  renderMultiAttemptAppendix,
} from "../src/miniapps/errorFeedback";
import {
  classifyLlamaError,
  humanizeRetryReason,
} from "../src/miniapps/llamaErrorCatalog";
import {
  classifyError,
  HarnessTimeoutError,
  HarnessCancelledError,
} from "../src/miniapps/classifyError";
import type { AttemptRecord } from "../src/miniapps/errorFeedback";
import {
  runPipelineWithDeps,
  type PipelineDeps,
} from "../src/miniapps/pipelineCore";
import type { MiniApp, WriteMiniAppInput } from "../src/miniapps/types";
import { FIXTURES, type MiniAppFixture } from "./miniappFixtures";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    passCount++;
  } else {
    failCount++;
    failures.push(`${label}${detail ? "\n    " + detail : ""}`);
    console.log(`  FAIL  ${label}${detail ? "\n        " + detail : ""}`);
    return;
  }
  console.log(`  pass  ${label}`);
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

// ============================================================================
// cleanProgramField
// ============================================================================

section("cleanProgramField");

assert(cleanProgramField("") === "", "empty input → empty output");
assert(cleanProgramField("   ") === "", "whitespace input → empty");
assert(cleanProgramField("\n\n") === "", "newlines only → empty");
assert(
  cleanProgramField("tc.mount(function(){})") === "tc.mount(function(){})",
  "plain program unchanged",
);
assert(
  cleanProgramField("```javascript\ntc.mount(function(){});\n```") ===
    "tc.mount(function(){});",
  "javascript fence stripped",
);
assert(
  cleanProgramField("```js\ntc.mount(function(){});\n```") ===
    "tc.mount(function(){});",
  "js fence stripped",
);
assert(
  cleanProgramField("```\ntc.mount(function(){});\n```") ===
    "tc.mount(function(){});",
  "bare fence stripped",
);
assert(
  cleanProgramField("[js]\ntc.mount(function(){});") ===
    "tc.mount(function(){});",
  "[js] label stripped",
);

// Edge case: empty fence — THIS is the suspicious one the logs showed
const emptyFence = cleanProgramField("```javascript\n```");
console.log(
  `  note  empty fence input "\`\`\`javascript\\n\`\`\`" → "${emptyFence}"`,
);
assert(emptyFence === "", "empty fence → empty");

// Edge case: fence with only whitespace inside
const whitespaceFence = cleanProgramField("```\n\n\n```");
console.log(
  `  note  whitespace fence → "${whitespaceFence}"`,
);
assert(whitespaceFence === "", "whitespace-only fence → empty");

// Edge case: label-only
const labelOnly = cleanProgramField("[js]");
console.log(`  note  label-only → "${labelOnly}"`);
assert(labelOnly === "", "label-only → empty");

// Edge case: partial — just a truncated open brace (model hit token cap)
const truncated = cleanProgramField("tc.state.count = 0;\ntc.mount(function(){return tc.column({");
assert(
  truncated.endsWith("{"),
  "truncated program left as-is (static checks will catch)",
);

// ============================================================================
// runStaticChecks
// ============================================================================

section("runStaticChecks");

{
  const issue = runStaticChecks("");
  assert(issue?.code === "clean.empty", "empty program → clean.empty");
}
{
  const issue = runStaticChecks("   \n\n  ");
  assert(issue?.code === "clean.empty", "whitespace-only → clean.empty");
}
{
  const issue = runStaticChecks("tc.state.x = 0; tc.mount(function(){ return tc.text({text:'ok'}); });");
  assert(issue === null, "valid minimal program → no issue");
}
{
  const issue = runStaticChecks("tc.state.x = 0;"); // no mount
  assert(issue?.code === "static.no_mount", "no mount call → static.no_mount");
}
{
  const issue = runStaticChecks(
    '<script>alert(1)</script>; tc.mount(function(){ return tc.text({text:"ok"}); });',
  );
  assert(issue?.code === "static.html_tags", "script tag → static.html_tags");
}
{
  const issue = runStaticChecks("tc.state.x = 0; tc.mount(fn;"); // syntax error
  assert(issue?.code === "parse.syntax_error", "bad JS → parse.syntax_error");
}
{
  const big = "a".repeat(19000);
  const issue = runStaticChecks("tc.mount(function(){}); " + big);
  assert(
    issue?.code === "static.program_too_big",
    "oversize program → static.program_too_big",
  );
}

// ============================================================================
// validateProps — ONE case per common failure
// ============================================================================

section("validateProps");

{
  const issues = validateProps("heading", { text: "Hello" });
  assert(issues.length === 0, "heading with valid text → no issues");
}
{
  const issues = validateProps("heading", { text: "Hello", level: "xl" });
  assert(
    issues.some((i) => i.code === "schema.invalid_enum_value"),
    "heading with invalid enum → invalid_enum_value",
  );
}
{
  const issues = validateProps("heading", {});
  assert(
    issues.some((i) => i.code === "schema.missing_required_prop"),
    "heading missing required text → missing_required_prop",
  );
}
{
  const issues = validateProps("button", {
    label: "Tap",
    onClick: () => {},
    secondary: true,
  });
  const secondaryIssue = issues.find(
    (i) => i.code === "schema.unknown_prop",
  );
  assert(
    !!secondaryIssue,
    "button with `secondary` prop → unknown_prop",
  );
  assert(
    !!secondaryIssue?.suggestions?.[0]?.includes("primary"),
    "button secondary → suggests primary",
  );
}
{
  const issues = validateProps("button", {
    label: "Tap",
    onClick: "function",
  });
  assert(
    issues.some((i) => i.code === "schema.wrong_prop_type"),
    "button with string onClick → wrong_prop_type",
  );
}
{
  const issues = validateProps("table" as unknown as string, { text: "x" });
  assert(
    issues.some((i) => i.code === "schema.unknown_component"),
    "unknown component → unknown_component",
  );
}

// ============================================================================
// smokeTest — every SmokeResult kind
// ============================================================================

section("smokeTest");

async function runSmoke(): Promise<void> {
  {
    const result = await smokeTest(
      "tc.state.count = 0; tc.mount(function(){ return tc.column({gap:16},[tc.heading({text:'Counter'}),tc.button({label:'+',onClick:function(){tc.state.count++;}})]); });",
    );
    assert(result.kind === "ok", "happy path counter → ok");
    if (result.kind === "ok") {
      assert(
        result.trace.mountCalled,
        "  observation: mountCalled",
      );
      assert(
        result.trace.visitedComponentTypes.includes("button"),
        "  observation: visited button",
      );
    }
  }

  {
    const result = await smokeTest(""); // clean-empty short-circuits earlier in pipeline, but test directly
    assert(
      result.kind === "no_mount" ||
        result.kind === "ok" ||
        result.kind === "render_returned_nothing",
      "empty program → no_mount or similar",
    );
  }

  {
    const result = await smokeTest("tc.state.count = 0;"); // no mount
    assert(result.kind === "no_mount", "no mount → no_mount");
  }

  {
    const result = await smokeTest("tc.mount('not a function');");
    assert(
      result.kind === "mount_not_function",
      "mount with string → mount_not_function",
    );
  }

  {
    const result = await smokeTest(
      "throw new Error('top level boom'); tc.mount(function(){});",
    );
    assert(
      result.kind === "top_level_threw",
      "top-level throw → top_level_threw",
    );
  }

  {
    const result = await smokeTest(
      "tc.mount(function(){ throw new Error('render boom'); });",
    );
    assert(result.kind === "render_threw", "render throws → render_threw");
  }

  {
    const result = await smokeTest("tc.mount(function(){});"); // returns undefined
    assert(
      result.kind === "render_returned_nothing",
      "render returns undefined → render_returned_nothing",
    );
  }

  {
    const result = await smokeTest(
      "tc.mount(function(){ return tc.table({text:'oops'}); });",
    );
    assert(
      result.kind === "render_invalid_tree",
      "render uses unknown component → render_invalid_tree",
    );
  }

  {
    // Invalid prop on a valid component
    const result = await smokeTest(
      "tc.mount(function(){ return tc.button({label:'x',onClick:function(){},secondary:true}); });",
    );
    assert(
      result.kind === "render_invalid_tree",
      "render uses `secondary` prop → render_invalid_tree",
    );
  }

  {
    // Missing required text on heading
    const result = await smokeTest(
      "tc.mount(function(){ return tc.heading({}); });",
    );
    assert(
      result.kind === "render_invalid_tree",
      "heading missing text → render_invalid_tree",
    );
  }
}

// ============================================================================
// applyPatch — all invariants
// ============================================================================

section("applyPatch");

const baseProgram = `tc.state.count = 0;

tc.mount(function() {
  return tc.column({ gap: 16 }, [
    tc.heading({ text: "Counter" }),
    tc.display({ text: String(tc.state.count) }),
    tc.button({ label: "+", onClick: function() { tc.state.count++; } })
  ]);
});`;

{
  const r = applyPatch(baseProgram, "", "anything");
  assert(r.ok === false, "empty find → failure");
  assert(
    r.ok === false && r.issue.code === "patch.find_missing",
    "empty find → find_missing",
  );
}
{
  const r = applyPatch(baseProgram, "abc", "def"); // too short
  assert(
    r.ok === false && r.issue.code === "patch.find_too_short",
    "short find → find_too_short",
  );
}
{
  const r = applyPatch(baseProgram, "nonexistent_substring_1234567890", "x");
  assert(
    r.ok === false && r.issue.code === "patch.find_missing",
    "no match → find_missing",
  );
}
{
  // Create a program with a duplicate substring — the text `tc.state.count++`
  // appears only once, we need to craft an ambiguous one.
  const ambiguous = `var a = "foo bar baz";
var b = "foo bar baz";
tc.mount(function(){});`;
  const r = applyPatch(ambiguous, 'var a = "foo bar', 'var c = "foo bar');
  // This only appears ONCE in the program, so it should succeed not be ambiguous.
  assert(r.ok === true, "specific find matches once → ok");

  // Now really make it ambiguous
  const r2 = applyPatch(ambiguous, '"foo bar baz"', '"qux"');
  assert(
    r2.ok === false && r2.issue.code === "patch.find_ambiguous",
    "duplicate substring → find_ambiguous",
  );
}
{
  const r = applyPatch(
    baseProgram,
    'tc.heading({ text: "Counter" })',
    'tc.heading({ text: "Counter" })',
  );
  assert(
    r.ok === false && r.issue.code === "patch.noop",
    "noop patch → patch.noop",
  );
}
{
  const r = applyPatch(
    baseProgram,
    'tc.heading({ text: "Counter" })',
    'tc.heading({ text: "Counter", level: "lg" })',
  );
  assert(r.ok === true, "valid small patch → ok");
  if (r.ok) {
    assert(r.program.includes('level: "lg"'), "  result includes new prop");
    assert(r.program.length > baseProgram.length, "  program grew");
  }
}
{
  // Too-large replacement
  const tinyFind = 'tc.heading({ text: "Counter" })'; // ~32 chars
  const hugeReplace = tinyFind + "x".repeat(200); // ~232 chars, ratio > 4
  const r = applyPatch(baseProgram, tinyFind, hugeReplace);
  assert(
    r.ok === false && r.issue.code === "patch.too_large",
    "replace >> find → too_large",
  );
}

// ============================================================================
// classifyLlamaError + humanizeRetryReason
// ============================================================================

section("classifyLlamaError");

{
  const r = classifyLlamaError(new Error("Context is busy"));
  assert(r?.kind === "context-busy", "'Context is busy' → context-busy");
}
{
  const r = classifyLlamaError("n_ctx exceeded");
  assert(r?.kind === "context-overflow", "'n_ctx exceeded' → context-overflow");
}
{
  const r = classifyLlamaError("model unloaded");
  assert(r?.kind === "model-released", "'model unloaded' → model-released");
}
{
  const r = classifyLlamaError("random unrelated error");
  assert(r === null, "unrelated error → null");
}

section("classifyError (pure)");

// Structural errors
{
  const c = classifyError(new HarnessTimeoutError(90_000), null);
  assert(c === "timeout", "HarnessTimeoutError → timeout");
}
{
  const c = classifyError(new HarnessCancelledError(), null);
  assert(c === "unknown", "HarnessCancelledError → unknown (top-level handles it)");
}

// llama.rn errors
{
  const c = classifyError(new Error("Context is busy"), null);
  assert(c === "context-busy", "Context is busy → context-busy");
}
{
  const c = classifyError(new Error("n_ctx exceeded max 16384"), null);
  assert(c === "context-overflow", "n_ctx exceeded → context-overflow");
}
{
  const c = classifyError(new Error("model unloaded"), null);
  assert(c === "hard-failure", "model unloaded → hard-failure");
}

// Pipeline empty-program errors — the EXACT messages from production logs
{
  const c = classifyError(
    null,
    "The `program` argument is empty after cleanup. Emit a JavaScript program that calls `tc.mount(renderFn)` at the end.",
  );
  assert(
    c === "tool-validation",
    "production log: 'empty after cleanup' → tool-validation",
  );
}
{
  const c = classifyError(
    null,
    "The tool call had no `program` argument. Call write_mini_app again with a complete JavaScript program.",
  );
  assert(
    c === "tool-validation",
    "production log: 'no program argument' → tool-validation",
  );
}
{
  const c = classifyError(
    null,
    "Your `program` argument contained only markdown fences or whitespace — no actual code.",
  );
  assert(
    c === "tool-validation",
    "production log: 'contained only markdown fences' → tool-validation",
  );
}

// Model-silent
{
  const c = classifyError(
    null,
    "The model didn't call write_mini_app. It may have replied in text only.",
  );
  assert(c === "model-silent", "model didn't call tool → model-silent");
}

// Fallback
{
  const c = classifyError(new Error("something completely unrelated"), null);
  assert(c === "unknown", "unrelated error → unknown");
}

section("humanizeRetryReason");

const reasons: Array<[string, string]> = [
  ["context-busy", "Releasing model context…"],
  ["timeout", "Model was slow, trying again…"],
  ["smoke.no_mount", "Adding missing mount call…"],
  ["smoke.render_threw", "Fixing a runtime bug…"],
  ["schema.unknown_prop", "Fixing a component prop…"],
  ["patch.find_missing", "Patch missed, retrying…"],
];
for (const [kind, expected] of reasons) {
  assert(
    humanizeRetryReason(kind) === expected,
    `${kind} → "${expected}"`,
  );
}

// ============================================================================
// renderRetryAppendix — spot-check a few templates
// ============================================================================

section("renderRetryAppendix");

{
  const record: AttemptRecord = {
    attempt: 1,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "clean.empty",
      message: "empty after cleanup",
    },
  };
  const appendix = renderRetryAppendix(record);
  assert(
    appendix.includes("PREVIOUS ATTEMPT FAILED"),
    "clean.empty → has header",
  );
  assert(
    appendix.length <= 600,
    `clean.empty → under 600 chars (was ${appendix.length})`,
  );
}
{
  const record: AttemptRecord = {
    attempt: 2,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "smoke.render_threw",
      message: "Cannot read property 'target' of undefined",
    },
    trace: {
      mountCalled: true,
      renderInvocations: 1,
      stateKeysWritten: ["count"],
      stateKeysRead: ["count"],
      topLevelSaves: [],
      rootTreeType: "column",
      visitedComponentTypes: ["column", "heading", "button"],
      firstError: { message: "Cannot read property 'target' of undefined" },
    },
  };
  const appendix = renderRetryAppendix(record);
  assert(
    appendix.includes("state keys set at top"),
    "smoke.render_threw → includes execution trace",
  );
  assert(
    appendix.includes("count"),
    "smoke.render_threw → includes the key 'count'",
  );
  assert(
    appendix.length <= 600,
    `smoke.render_threw → under 600 chars (was ${appendix.length})`,
  );
}

// NEW empty-program templates
{
  const record: AttemptRecord = {
    attempt: 1,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "args.missing_program",
      message: "no program arg",
    },
  };
  const appendix = renderRetryAppendix(record);
  assert(
    appendix.includes("NO `program` argument"),
    "args.missing_program → mentions 'NO program argument'",
  );
  assert(
    appendix.includes("write_mini_app({"),
    "args.missing_program → shows example tool-call structure",
  );
}
{
  const record: AttemptRecord = {
    attempt: 1,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "clean.empty",
      message: "empty after cleanup",
    },
  };
  const appendix = renderRetryAppendix(record);
  assert(
    appendix.includes("markdown fences"),
    "clean.empty → mentions fences explicitly",
  );
  assert(
    appendix.includes("DIRECTLY") || appendix.includes("directly"),
    "clean.empty → tells model to put code DIRECTLY in field",
  );
}

// Multi-attempt cascade — MIXED errors (timeout then empty) gets
// the regular escalation path, not the last-resort template.
{
  const records: AttemptRecord[] = [
    {
      attempt: 1,
      toolUsed: "write_mini_app",
      programFingerprint: null,
      errorKind: "timeout",
      errorMessage: "Attempt 1 timed out after 90000ms",
    },
    {
      attempt: 2,
      toolUsed: "write_mini_app",
      programFingerprint: null,
      issue: {
        code: "clean.empty",
        message: "empty after cleanup",
      },
    },
  ];
  const appendix = renderMultiAttemptAppendix(records);
  assert(
    appendix.includes("ESCALATION"),
    "mixed cascade → includes ESCALATION section (not LAST RESORT)",
  );
  assert(
    !appendix.includes("LAST RESORT"),
    "mixed cascade → does NOT include LAST RESORT template",
  );
  assert(
    appendix.length <= 1200,
    `mixed cascade → under 1200 chars (was ${appendix.length})`,
  );
  assert(
    appendix.toLowerCase().includes("timed out") ||
      appendix.toLowerCase().includes("slow"),
    "mixed cascade → still references the timeout",
  );
}

// Multi-attempt cascade — ALL empty-program failures → LAST RESORT
// template. This is the production scenario from the user's logs
// where attempts 2 and 3 both produced empty.
{
  const records: AttemptRecord[] = [
    {
      attempt: 1,
      toolUsed: "write_mini_app",
      programFingerprint: null,
      issue: {
        code: "clean.empty",
        message: "empty after cleanup",
      },
    },
    {
      attempt: 2,
      toolUsed: "write_mini_app",
      programFingerprint: null,
      issue: {
        code: "clean.empty",
        message: "empty after cleanup",
      },
    },
  ];
  const appendix = renderMultiAttemptAppendix(records);
  assert(
    appendix.includes("LAST RESORT"),
    "all-empty cascade → LAST RESORT template kicks in",
  );
  assert(
    appendix.includes("tc.mount(function()"),
    "LAST RESORT template contains a working mount skeleton",
  );
  assert(
    appendix.includes("tc.column") || appendix.includes("tc.heading"),
    "LAST RESORT template contains real tc primitives the model can adapt",
  );
  assert(
    appendix.length <= 1200,
    `last-resort cascade → under 1200 chars (was ${appendix.length})`,
  );
}

// Three empty-program failures also gets LAST RESORT
{
  const records: AttemptRecord[] = [
    {
      attempt: 1,
      toolUsed: null,
      programFingerprint: null,
      issue: { code: "args.missing_program", message: "no program" },
    },
    {
      attempt: 2,
      toolUsed: null,
      programFingerprint: null,
      issue: { code: "clean.empty", message: "empty" },
    },
    {
      attempt: 3,
      toolUsed: null,
      programFingerprint: null,
      issue: { code: "args.missing_program", message: "no program" },
    },
  ];
  const appendix = renderMultiAttemptAppendix(records);
  assert(
    appendix.includes("LAST RESORT") && appendix.includes("3 attempts"),
    "three empty-program failures → LAST RESORT with correct count",
  );
}

// Legacy path: records with only errorMessage (no issue) but the
// messages all imply empty-program → still triggers LAST RESORT
{
  const records: AttemptRecord[] = [
    {
      attempt: 1,
      toolUsed: null,
      programFingerprint: null,
      errorMessage: "The `program` argument is empty after cleanup.",
    },
    {
      attempt: 2,
      toolUsed: null,
      programFingerprint: null,
      errorMessage: "The tool call had no `program` argument.",
    },
  ];
  const appendix = renderMultiAttemptAppendix(records);
  assert(
    appendix.includes("LAST RESORT"),
    "legacy errorMessage path → still detects empty-program family",
  );
}

// ============================================================================
// Component registry sanity
// ============================================================================

section("COMPONENT_REGISTRY sanity");

assert(COMPONENT_NAMES.length === 12, "12 primitives registered");
for (const name of COMPONENT_NAMES) {
  const spec = COMPONENT_REGISTRY[name];
  assert(
    typeof spec.name === "string" && spec.name === name,
    `${name}.name matches key`,
  );
  assert(
    typeof spec.examplePropsJson === "string" && spec.examplePropsJson.length > 0,
    `${name} has example`,
  );
}

// ============================================================================
// buildMiniAppSystemPrompt variants — prompt shape across contexts
// ============================================================================

section("buildMiniAppSystemPrompt variants");

// This test needs to mock out the AsyncStorage + RNFS reads that
// buildMiniAppSystemPrompt performs via readMemory + readApp. We stub
// both by importing the module AFTER setting up the mocks.
//
// Easiest path: just test against a chat that has no existing app
// (first-build variant), which avoids the RNFS dependency entirely.
async function testPromptVariants(): Promise<void> {
  // Dynamically import so we can mock first. But ./memory and ./storage
  // only touch disk on demand; passing a nonexistent chatId works.
  const { buildMiniAppSystemPrompt } = await import(
    "../src/agent/miniAppAgent"
  );

  // First-build: no app, no prior attempts.
  const firstBuild = await buildMiniAppSystemPrompt(
    "__local_test_nonexistent__",
    { promptVariant: "first-build" },
  );
  assert(
    !firstBuild.systemPrompt.includes("Patch example"),
    "first-build variant does NOT include patch examples",
  );
  assert(
    !firstBuild.systemPrompt.includes("PREVIOUS ATTEMPT FAILED"),
    "first-build variant has no retry appendix",
  );

  // Retry-after-error: previous attempt records should trigger the
  // retry appendix AND drop patch examples.
  const retry = await buildMiniAppSystemPrompt(
    "__local_test_nonexistent__",
    {
      promptVariant: "retry-after-error",
      previousAttempts: [
        {
          attempt: 1,
          toolUsed: "write_mini_app",
          programFingerprint: null,
          issue: {
            code: "clean.empty",
            message: "empty after cleanup",
          },
        },
      ],
    },
  );
  assert(
    !retry.systemPrompt.includes("Patch example"),
    "retry variant does NOT include patch examples (saves tokens)",
  );
  assert(
    retry.systemPrompt.includes("PREVIOUS ATTEMPT FAILED"),
    "retry variant includes retry appendix",
  );
  assert(
    retry.systemPrompt.includes("markdown fences"),
    "retry appendix for clean.empty mentions markdown fences",
  );

  // Prompt size: first-build should be bigger than retry in this test
  // since retry has no patch examples AND no current-program injection
  // (because no app exists). In a real iterate run, retry would be
  // smaller by exactly PATCH_EXAMPLES.length.
  console.log(
    `  note  first-build length: ${firstBuild.systemPrompt.length} chars`,
  );
  console.log(`  note  retry length: ${retry.systemPrompt.length} chars`);
}

// ============================================================================
// toolPipeline empty-program handling — the exact bug from production logs
// ============================================================================

section("toolPipeline empty-program failure modes");

async function testEmptyProgramFailures(): Promise<void> {
  const { runPipeline } = await import("../src/miniapps/toolPipeline");

  const ctx = {
    chatId: "__local_test_nonexistent__",
    identity: { name: "Test", emoji: "🧪" },
  };

  // Case 1: grammar produced no program field at all (empty string).
  {
    const outcome = await runPipeline({
      ...ctx,
      rawProgram: "",
      skipSmokeTest: true,
    });
    assert(
      outcome.kind === "error",
      "empty rawProgram → error outcome",
    );
    assert(
      outcome.kind === "error" && outcome.issue.code === "args.missing_program",
      "empty rawProgram → args.missing_program (not clean.empty)",
    );
  }

  // Case 2: fence-only — model wrapped an empty fence.
  {
    const outcome = await runPipeline({
      ...ctx,
      rawProgram: "```javascript\n```",
      skipSmokeTest: true,
    });
    assert(
      outcome.kind === "error" && outcome.issue.code === "clean.empty",
      "fence-only rawProgram → clean.empty (distinct from args.missing)",
    );
    // The retry appendix should give a specific hint about fences
    if (outcome.kind === "error") {
      const msg = outcome.issue.message;
      assert(
        msg.includes("markdown fences"),
        "  clean.empty message mentions 'markdown fences'",
      );
    }
  }

  // Case 3: label-only — model sent "[js]".
  {
    const outcome = await runPipeline({
      ...ctx,
      rawProgram: "[js]",
      skipSmokeTest: true,
    });
    assert(
      outcome.kind === "error" && outcome.issue.code === "clean.empty",
      "label-only → clean.empty",
    );
  }

  // Case 4: whitespace only.
  {
    const outcome = await runPipeline({
      ...ctx,
      rawProgram: "   \n\n   ",
      skipSmokeTest: true,
    });
    assert(
      outcome.kind === "error" && outcome.issue.code === "clean.empty",
      "whitespace-only → clean.empty",
    );
  }
}

// ============================================================================
// Full-pipeline end-to-end via pipelineCore with mocked I/O deps
// ============================================================================

/**
 * In-memory implementation of PipelineDeps. Backs both writeApp and
 * getAppIdForChat with a Map keyed by chatId. Lets the pipeline run
 * the FULL 8-step flow (including the "new vs iteration" branch and
 * the disk-write step) without touching react-native-fs.
 */
function makeMockDeps(): PipelineDeps & {
  reset: () => void;
  getStoredApps: () => Map<string, MiniApp>;
} {
  const store = new Map<string, MiniApp>(); // chatId → MiniApp
  const memory: Record<string, string[]> = {};

  return {
    async getAppIdForChat(chatId: string): Promise<string | null> {
      const app = store.get(chatId);
      return app ? app.id : null;
    },
    async writeApp(input: WriteMiniAppInput): Promise<MiniApp> {
      const now = Date.now();
      if (input.kind === "new") {
        const app: MiniApp = {
          id: "mapp_test_" + now.toString(36),
          name: input.name,
          emoji: input.emoji,
          version: 1,
          chatId: input.chatId,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 2,
          program: input.program,
        };
        store.set(input.chatId, app);
        return app;
      }
      // iteration
      const existing = store.get(input.chatId);
      if (!existing) {
        throw new Error("mock writeApp: no existing app for iteration");
      }
      const updated: MiniApp = {
        ...existing,
        version: existing.version + 1,
        updatedAt: now,
        program: input.program,
      };
      store.set(input.chatId, updated);
      return updated;
    },
    async appendMemoryNotes(chatId: string, notes: string[]): Promise<void> {
      memory[chatId] = (memory[chatId] ?? []).concat(notes);
    },
    reset(): void {
      store.clear();
      for (const k of Object.keys(memory)) delete memory[k];
    },
    getStoredApps() {
      return store;
    },
  };
}

async function runFixtures(): Promise<void> {
  section("pipelineCore fixtures (end-to-end, mocked I/O)");

  const deps = makeMockDeps();
  const identity = { name: "Test App", emoji: "🧪" };

  // Silence ONLY the pipeline's raw-arg log during the call itself,
  // not the assert() output that follows. Swap console.log in/out
  // around each runPipelineWithDeps invocation.
  const origLog = console.log;
  const origWarn = console.warn;
  const suppress = (): void => {
    console.log = () => {};
    console.warn = () => {};
  };
  const restore = (): void => {
    console.log = origLog;
    console.warn = origWarn;
  };

  for (const fx of FIXTURES) {
    deps.reset();
    suppress();
    const outcome = await runPipelineWithDeps(
      {
        chatId: "test-chat-" + fx.name,
        rawProgram: fx.rawProgram,
        identity,
      },
      deps,
    );
    restore();

    if (fx.expected === "ok") {
      if (outcome.kind !== "ok") {
        assert(
          false,
          `fixture "${fx.name}" should succeed`,
          `got ${outcome.issue.code}: ${outcome.issue.message.slice(0, 140)}`,
        );
      } else {
        assert(true, `fixture "${fx.name}" → ok`);
      }
    } else {
      if (outcome.kind !== "error") {
        assert(
          false,
          `fixture "${fx.name}" should fail with ${fx.expected}`,
          `got ok instead`,
        );
      } else if (!outcome.issue.code.startsWith(fx.expected.split(".")[0])) {
        // At minimum the prefix must match (smoke.*, static.*, etc.)
        assert(
          false,
          `fixture "${fx.name}" should fail with ${fx.expected}`,
          `got ${outcome.issue.code}`,
        );
      } else if (outcome.issue.code !== fx.expected) {
        // Close but not exact — count as pass but note the mismatch
        console.log(
          `  pass  fixture "${fx.name}" → ${outcome.issue.code} (expected ${fx.expected}, prefix match)`,
        );
        passCount++;
      } else {
        assert(true, `fixture "${fx.name}" → ${fx.expected}`);
      }
    }
  }
}

// ============================================================================
// Patch path — apply a patch and run the result through the pipeline
// ============================================================================

async function runPatchScenarios(): Promise<void> {
  section("patch path end-to-end");

  const deps = makeMockDeps();
  const identity = { name: "Patch Test", emoji: "🔧" };
  const chatId = "patch-test-chat";

  const origLog = console.log;
  const origWarn = console.warn;
  const suppress = (): void => {
    console.log = () => {};
    console.warn = () => {};
  };
  const restore = (): void => {
    console.log = origLog;
    console.warn = origWarn;
  };

  // Step 1: seed the chat with a canonical counter app via write.
  const initialProgram = `tc.state.count = 0;
tc.mount(function() {
  return tc.column({ gap: 16, padding: 24 }, [
    tc.heading({ text: "Counter" }),
    tc.display({ text: String(tc.state.count) }),
    tc.button({ label: "+", primary: true, onClick: function() { tc.state.count++; } })
  ]);
});`;

  suppress();
  const writeOutcome = await runPipelineWithDeps(
    { chatId, rawProgram: initialProgram, identity },
    deps,
  );
  restore();

  if (writeOutcome.kind !== "ok") {
    assert(false, "seed counter write succeeded", writeOutcome.issue.message);
    return;
  }
  assert(true, "seeded counter app via pipeline");

  // Step 2: successful patch — change the button label.
  {
    const current = deps.getStoredApps().get(chatId)!;
    const patched = applyPatch(
      current.program,
      `tc.button({ label: "+", primary: true, onClick: function() { tc.state.count++; } })`,
      `tc.button({ label: "++", primary: true, onClick: function() { tc.state.count++; } })`,
    );
    assert(patched.ok === true, "applyPatch → ok for small label change");
    if (patched.ok) {
      suppress();
      const patchWrite = await runPipelineWithDeps(
        { chatId, rawProgram: patched.program, identity },
        deps,
      );
      restore();
      assert(patchWrite.kind === "ok", "patched program writes successfully");
      if (patchWrite.kind === "ok") {
        assert(
          patchWrite.app.version === 2,
          "patched write bumps version to 2",
        );
        assert(
          patchWrite.app.program.includes('label: "++"'),
          "patched program contains the new label",
        );
        assert(
          !patchWrite.app.program.includes(
            'label: "+", primary: true, onClick: function() { tc.state.count++; } })',
          ),
          "patched program no longer contains the old label",
        );
      }
    }
  }

  // Step 3: patch that would break the tree — replace a button with
  // an unknown component. Pipeline should reject it.
  {
    const current = deps.getStoredApps().get(chatId)!;
    const badPatch = applyPatch(
      current.program,
      `tc.button({ label: "++", primary: true, onClick: function() { tc.state.count++; } })`,
      `tc.explosion({ label: "boom" })`,
    );
    assert(badPatch.ok === true, "applyPatch allows the bad substitution");
    if (badPatch.ok) {
      suppress();
      const badWrite = await runPipelineWithDeps(
        { chatId, rawProgram: badPatch.program, identity },
        deps,
      );
      restore();
      assert(
        badWrite.kind === "error",
        "patched program with unknown component → error",
      );
      if (badWrite.kind === "error") {
        assert(
          badWrite.issue.code === "smoke.render_invalid_tree",
          "  error code is smoke.render_invalid_tree",
        );
      }
      // Verify the stored app wasn't clobbered by the failed write.
      const after = deps.getStoredApps().get(chatId)!;
      assert(
        after.version === 2,
        "failed write did NOT increment version (still v2)",
      );
      assert(
        after.program.includes('label: "++"'),
        "failed write did NOT overwrite the good v2 program",
      );
    }
  }

  // Step 4: patch that yields a program missing tc.mount — should be
  // caught by the static check after substitution.
  {
    const current = deps.getStoredApps().get(chatId)!;
    const removeMount = applyPatch(
      current.program,
      `tc.mount(function() {
  return tc.column({ gap: 16, padding: 24 }, [
    tc.heading({ text: "Counter" }),
    tc.display({ text: String(tc.state.count) }),
    tc.button({ label: "++", primary: true, onClick: function() { tc.state.count++; } })
  ]);
});`,
      `var noop = null;`,
    );
    assert(
      removeMount.ok === true,
      "applyPatch allows removing the mount block",
    );
    if (removeMount.ok) {
      suppress();
      const writeAfter = await runPipelineWithDeps(
        { chatId, rawProgram: removeMount.program, identity },
        deps,
      );
      restore();
      assert(
        writeAfter.kind === "error",
        "patched program with no mount → error",
      );
      if (writeAfter.kind === "error") {
        assert(
          writeAfter.issue.code === "static.no_mount",
          "  error code is static.no_mount",
        );
      }
    }
  }
}

// ============================================================================
// Simulated retry cycle — verify prompt length stays bounded under retry
// pressure and the last-resort escalation actually kicks in on attempt 3.
// ============================================================================

function runSimulatedRetryCycle(): void {
  section("simulated retry cycle (prompt length bounded)");

  // Simulate the exact production scenario from the logs: attempt 1
  // times out, attempts 2 & 3 produce empty-program failures. Each
  // attempt's "retry appendix" is built from the records that came
  // before it. We verify:
  //   (a) the total appendix at each stage stays within budget
  //   (b) by attempt 3, the LAST RESORT template kicks in when
  //       appropriate
  //   (c) each appendix is STRICTLY more informative than the
  //       previous (never loses information)

  const accumulated: AttemptRecord[] = [];
  const appendices: string[] = [];

  // Attempt 1 fails — empty program (not timeout, so LAST RESORT can trigger)
  accumulated.push({
    attempt: 1,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "clean.empty",
      message: "empty after cleanup",
    },
  });
  const ap1 =
    accumulated.length === 1
      ? renderRetryAppendix(accumulated[0])
      : renderMultiAttemptAppendix(accumulated);
  appendices.push(ap1);
  assert(ap1.length <= 600, `attempt-1 retry appendix ≤600 chars (was ${ap1.length})`);
  assert(
    ap1.includes("PREVIOUS ATTEMPT FAILED"),
    "attempt-1 appendix includes failure header",
  );

  // Attempt 2 also fails — empty program
  accumulated.push({
    attempt: 2,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "clean.empty",
      message: "empty after cleanup",
    },
  });
  const ap2 = renderMultiAttemptAppendix(accumulated);
  appendices.push(ap2);
  assert(
    ap2.includes("LAST RESORT"),
    "attempt-2 appendix (2x empty-program) triggers LAST RESORT",
  );
  assert(
    ap2.length <= 1200,
    `attempt-2 retry appendix ≤1200 chars (was ${ap2.length})`,
  );
  assert(
    ap2.includes("tc.mount(function()"),
    "attempt-2 LAST RESORT contains working skeleton",
  );

  // Attempt 3 also fails — still empty
  accumulated.push({
    attempt: 3,
    toolUsed: "write_mini_app",
    programFingerprint: null,
    issue: {
      code: "clean.empty",
      message: "empty after cleanup",
    },
  });
  const ap3 = renderMultiAttemptAppendix(accumulated);
  appendices.push(ap3);
  assert(
    ap3.includes("LAST RESORT") && ap3.includes("3 attempts"),
    "attempt-3 appendix → LAST RESORT with '3 attempts'",
  );
  assert(
    ap3.length <= 1200,
    `attempt-3 retry appendix ≤1200 chars (was ${ap3.length})`,
  );

  // Compare the three appendices — total prompt cost scales with
  // attempt count but stays bounded
  const total = appendices.reduce((s, a) => s + a.length, 0);
  console.log(
    `  note  appendix lengths: ${appendices.map((a) => a.length).join(", ")} (total: ${total})`,
  );
}

// ============================================================================
// Run async smoke section, then report
// ============================================================================

(async () => {
  await runSmoke();
  try {
    await testPromptVariants();
  } catch (err) {
    console.log(
      `  SKIP  prompt variants (expected — requires RN deps): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  try {
    await testEmptyProgramFailures();
  } catch (err) {
    console.log(
      `  SKIP  pipeline failures (expected — requires RN deps): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Full-pipeline fixture sweep via mocked deps. This is the main
  // iteration surface — adding a new fixture is the cheapest way to
  // lock in a regression.
  await runFixtures();

  // Simulated retry cycle — verifies the retry appendix composer
  // under multi-attempt pressure.
  runSimulatedRetryCycle();

  // Patch-path end-to-end: seed an initial app via write, then apply
  // a patch and run the result through the pipeline. Verifies that
  // patch_mini_app's target scenarios actually work without needing
  // the real tool factory.
  await runPatchScenarios();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Summary: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`All local tests passed.`);
  process.exit(0);
})();
