/**
 * End-to-end test: real Gemma E2B inference + real validation pipeline.
 *
 * Prerequisites:
 *   - `llama-server` running on 127.0.0.1:18080 with the Gemma E2B
 *     gguf loaded (see scripts/start-llama-server.sh)
 *
 * What this does:
 *   1. Builds the EXACT system prompt the production agent sends
 *      (base + patch examples for iterate variant, or plain for
 *      first-build)
 *   2. Posts to llama-server's OpenAI-compatible /v1/chat/completions
 *      endpoint with the write_mini_app + patch_mini_app tool
 *      definitions
 *   3. Parses the tool call out of the response
 *   4. Runs the result through runPipelineWithDeps with a mocked
 *      in-memory writer
 *   5. Reports what happened — model output, tool call args, pipeline
 *      outcome, full program contents if successful
 *
 * Usage:
 *   npm run test:miniapp:e2e                         # default: tip calculator
 *   npm run test:miniapp:e2e -- "build me a counter" # custom prompt
 *   npm run test:miniapp:e2e -- --scenario full      # run all canned scenarios
 */

import {
  runPipelineWithDeps,
  type PipelineDeps,
} from "../src/miniapps/pipelineCore";
import {
  BASE_SYSTEM_PROMPT,
  PATCH_EXAMPLES,
  WRITE_MINI_APP_DESCRIPTION,
  PATCH_MINI_APP_DESCRIPTION,
} from "../src/agent/miniAppPromptText";
import type { MiniApp, WriteMiniAppInput } from "../src/miniapps/types";

const LLAMA_URL = process.env.LLAMA_URL ?? "http://127.0.0.1:18080";
const MAX_TOKENS = 3072;

// ────────────────────────────────────────────────────────────────────
// Tool definitions (OpenAI chat-completions shape)
// ────────────────────────────────────────────────────────────────────

const TOOLS_OPENAI_FORMAT = [
  {
    type: "function",
    function: {
      name: "write_mini_app",
      description: WRITE_MINI_APP_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          program: {
            type: "string",
            description:
              "Complete JavaScript program using the tc component runtime. " +
              "Must call tc.mount(renderFn) at the end. No HTML, no CSS, " +
              "no tags — the runtime handles rendering.",
          },
          notes: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional. Up to 3 short one-liners (<240 chars each) about " +
              "key decisions, user preferences, or current-app facts to " +
              "remember across turns.",
          },
        },
        required: ["program"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_mini_app",
      description: PATCH_MINI_APP_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          find: {
            type: "string",
            description:
              "Exact text to locate in the current program. Must match " +
              "EXACTLY ONCE (whitespace-sensitive). Copy it verbatim from " +
              "the `Current program` block in the system prompt. Keep it " +
              "short but unique — typically one statement or one object " +
              "literal, 2-8 lines.",
          },
          replace: {
            type: "string",
            description:
              "New text that will replace `find`. Must be valid JavaScript " +
              "in context. Do NOT include backticks or markdown fences.",
          },
          notes: {
            type: "array",
            items: { type: "string" },
            description: "Optional short notes to remember across turns.",
          },
        },
        required: ["find", "replace"],
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// In-memory pipeline deps (same as in test-miniapp-local.ts)
// ────────────────────────────────────────────────────────────────────

function makeMockDeps(): PipelineDeps & {
  reset: () => void;
  getStoredApps: () => Map<string, MiniApp>;
} {
  const store = new Map<string, MiniApp>();
  const memory: Record<string, string[]> = {};
  return {
    async getAppIdForChat(chatId) {
      const app = store.get(chatId);
      return app ? app.id : null;
    },
    async writeApp(input: WriteMiniAppInput) {
      const now = Date.now();
      if (input.kind === "new") {
        const app: MiniApp = {
          id: "mapp_e2e_" + now.toString(36),
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
      const existing = store.get(input.chatId);
      if (!existing) throw new Error("no existing app");
      const updated: MiniApp = {
        ...existing,
        version: existing.version + 1,
        updatedAt: now,
        program: input.program,
      };
      store.set(input.chatId, updated);
      return updated;
    },
    async appendMemoryNotes(chatId, notes) {
      memory[chatId] = (memory[chatId] ?? []).concat(notes);
    },
    reset() {
      store.clear();
      for (const k of Object.keys(memory)) delete memory[k];
    },
    getStoredApps() {
      return store;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Build prompt — first-build variant (no existing program, no retry)
// ────────────────────────────────────────────────────────────────────

function buildFirstBuildPrompt(): string {
  // First-build variant: base prompt ONLY — no patch examples, no
  // current program block, no retry appendix. Matches exactly what
  // buildMiniAppSystemPrompt returns for variant: "first-build".
  return BASE_SYSTEM_PROMPT;
}

function buildIteratePrompt(currentProgram: string, app: MiniApp): string {
  // Iterate variant: base + patch examples + current program block
  // with line numbers. Matches buildMiniAppSystemPrompt's iterate path.
  const lines = currentProgram.split("\n");
  const width = String(lines.length).length;
  const numbered = lines
    .map((line, i) => String(i + 1).padStart(width, " ") + "| " + line)
    .join("\n");

  return (
    BASE_SYSTEM_PROMPT +
    PATCH_EXAMPLES +
    `\n\n## Current program\n\n` +
    `Name: ${app.name}   Emoji: ${app.emoji}   Version: ${app.version} ` +
    `(you will produce v${app.version + 1})\n\n` +
    `Lines are numbered for reference. When calling patch_mini_app, ` +
    `copy the source text VERBATIM into \`find\` — do NOT include the ` +
    `"N| " line-number prefix.\n\n` +
    "```javascript\n" +
    numbered +
    "\n```"
  );
}

// ────────────────────────────────────────────────────────────────────
// Call llama-server
// ────────────────────────────────────────────────────────────────────

interface LlamaToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface LlamaResponse {
  content: string;
  reasoningContent: string;
  toolCalls: LlamaToolCall[];
  durationMs: number;
  tokensOut: number;
}

async function callLlama(
  systemPrompt: string,
  userMessage: string,
  opts: { dropPatchTool?: boolean } = {},
): Promise<LlamaResponse> {
  const startedAt = Date.now();
  // Escalation: if the caller says to drop patch_mini_app, only
  // expose write_mini_app in the tool list. Mirrors the production
  // harness's dropPatchTool behavior — stripping the tool from the
  // grammar is the only reliable way to force the model off a
  // patch-loop after repeated failures.
  const tools = opts.dropPatchTool
    ? TOOLS_OPENAI_FORMAT.filter((t) => t.function.name === "write_mini_app")
    : TOOLS_OPENAI_FORMAT;

  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    tools,
    tool_choice: "auto",
    max_tokens: MAX_TOKENS,
    temperature: 0,
    // Thinking mode: controlled by E2E_THINKING env var.
    // Default OFF to match production harness (thinking: false).
    // Set E2E_THINKING=1 to enable for comparison benchmarks.
    chat_template_kwargs: {
      enable_thinking: process.env.E2E_THINKING === "1",
    },
    cache_prompt: true,
  };
  const res = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `llama-server returned ${res.status}: ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage: { completion_tokens: number };
  };
  const msg = data.choices[0]?.message ?? {
    content: "",
    tool_calls: [],
  };
  const toolCalls: LlamaToolCall[] = (msg.tool_calls ?? []).map((tc) => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.function.arguments);
    } catch {
      // Leave empty — the harness will classify this as malformed.
    }
    return { name: tc.function.name, arguments: parsedArgs };
  });
  return {
    content: msg.content ?? "",
    reasoningContent: msg.reasoning_content ?? "",
    toolCalls,
    durationMs: Date.now() - startedAt,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// One turn: prompt → llama → tool call → pipeline → report
// ────────────────────────────────────────────────────────────────────

interface TurnResult {
  userMessage: string;
  llama: LlamaResponse;
  toolUsed: string | null;
  pipelineOutcome: "ok" | "error";
  pipelineErrorCode?: string;
  pipelineErrorMessage?: string;
  writtenProgram?: string;
}

async function runTurn(
  deps: PipelineDeps,
  chatId: string,
  userMessage: string,
  /**
   * Optional retry appendix to append to the system prompt. Used by
   * runTurnWithRetries to simulate the production harness's retry
   * behavior — each retry gets a specific correction hint based on
   * what went wrong last time.
   */
  retryAppendix?: string,
  dropPatchTool: boolean = false,
): Promise<TurnResult> {
  // Pick the variant based on whether this chat already has an app
  const existing = (deps as ReturnType<typeof makeMockDeps>)
    .getStoredApps()
    .get(chatId);
  let systemPrompt = existing
    ? buildIteratePrompt(existing.program, existing)
    : buildFirstBuildPrompt();
  if (retryAppendix) systemPrompt += retryAppendix;

  const llama = await callLlama(systemPrompt, userMessage, { dropPatchTool });

  if (llama.toolCalls.length === 0) {
    return {
      userMessage,
      llama,
      toolUsed: null,
      pipelineOutcome: "error",
      pipelineErrorCode: "model_silent",
      pipelineErrorMessage:
        "Model returned text only, no tool call. Content: " +
        llama.content.slice(0, 200),
    };
  }

  const tc = llama.toolCalls[0];
  let rawProgram = "";
  if (tc.name === "write_mini_app") {
    rawProgram =
      typeof tc.arguments.program === "string" ? tc.arguments.program : "";
  } else if (tc.name === "patch_mini_app") {
    // For this harness, simulate the patch flow inline: load the
    // existing program and apply find/replace. In production the
    // patch tool does this via applyPatch + pipeline.
    const find =
      typeof tc.arguments.find === "string" ? tc.arguments.find : "";
    const replace =
      typeof tc.arguments.replace === "string" ? tc.arguments.replace : "";
    if (!existing) {
      return {
        userMessage,
        llama,
        toolUsed: "patch_mini_app",
        pipelineOutcome: "error",
        pipelineErrorCode: "patch.no_existing_app",
        pipelineErrorMessage:
          "Model called patch_mini_app but no app exists yet",
      };
    }
    if (existing.program.split(find).length !== 2) {
      return {
        userMessage,
        llama,
        toolUsed: "patch_mini_app",
        pipelineOutcome: "error",
        pipelineErrorCode:
          existing.program.includes(find)
            ? "patch.find_ambiguous"
            : "patch.find_missing",
        pipelineErrorMessage: "find text had wrong match count",
      };
    }
    rawProgram = existing.program.replace(find, replace);
  }

  const outcome = await runPipelineWithDeps(
    {
      chatId,
      rawProgram,
      identity: { name: "E2E Test", emoji: "🧪" },
    },
    deps,
  );

  if (outcome.kind === "ok") {
    return {
      userMessage,
      llama,
      toolUsed: tc.name,
      pipelineOutcome: "ok",
      writtenProgram: outcome.writtenProgram,
    };
  }
  return {
    userMessage,
    llama,
    toolUsed: tc.name,
    pipelineOutcome: "error",
    pipelineErrorCode: outcome.issue.code,
    pipelineErrorMessage: outcome.issue.message,
  };
}

// ────────────────────────────────────────────────────────────────────
// Pretty-print a turn result
// ────────────────────────────────────────────────────────────────────

function printTurn(turn: TurnResult, turnIdx: number, attempt: number = 0): void {
  const ICON = turn.pipelineOutcome === "ok" ? "✓" : "✗";
  const attemptSuffix = attempt > 0 ? ` (retry ${attempt})` : "";
  console.log(
    `\n${"═".repeat(72)}\nTurn ${turnIdx}${attemptSuffix}: "${turn.userMessage}"\n${"═".repeat(72)}`,
  );
  console.log(
    `Llama: ${turn.llama.durationMs}ms, ${turn.llama.tokensOut} tokens out`,
  );
  if (turn.llama.reasoningContent) {
    console.log(
      `  reasoning (first 200): ${turn.llama.reasoningContent.slice(0, 200).replace(/\n/g, " ")}`,
    );
  }
  if (turn.llama.content) {
    console.log(
      `  content (first 200): ${turn.llama.content.slice(0, 200).replace(/\n/g, " ")}`,
    );
  }
  console.log(
    `  tool_calls: ${turn.llama.toolCalls.length}${turn.toolUsed ? ` (used: ${turn.toolUsed})` : ""}`,
  );

  if (turn.toolUsed && turn.llama.toolCalls[0]) {
    const args = turn.llama.toolCalls[0].arguments;
    if (turn.toolUsed === "write_mini_app") {
      const program =
        typeof args.program === "string" ? args.program : "(not a string)";
      console.log(`  program length: ${program.length} chars`);
      if (program.length > 0 && program.length < 60) {
        console.log(`  program: ${JSON.stringify(program)}`);
      }
    } else if (turn.toolUsed === "patch_mini_app") {
      const find = typeof args.find === "string" ? args.find : "";
      const replace = typeof args.replace === "string" ? args.replace : "";
      console.log(`  find (${find.length} chars): ${JSON.stringify(find.slice(0, 80))}`);
      console.log(
        `  replace (${replace.length} chars): ${JSON.stringify(replace.slice(0, 80))}`,
      );
    }
  }

  console.log(`${ICON} Pipeline: ${turn.pipelineOutcome}`);
  if (turn.pipelineOutcome === "error") {
    console.log(`  code: ${turn.pipelineErrorCode}`);
    console.log(`  message: ${turn.pipelineErrorMessage?.slice(0, 400)}`);
    // On error, dump the model's raw output so we can see WHY it failed
    if (turn.toolUsed === "write_mini_app" && turn.llama.toolCalls[0]) {
      const raw = turn.llama.toolCalls[0].arguments.program;
      if (typeof raw === "string") {
        console.log(`  ── raw program the model emitted ──`);
        const ls = raw.split("\n");
        const errorCap = process.env.E2E_SHOW_FULL === "1" ? ls.length : 80;
        for (const l of ls.slice(0, errorCap))
          console.log(`    │ ${l}`);
        if (ls.length > errorCap) console.log(`    │ ... (${ls.length - errorCap} more)`);
      }
    }
  } else if (turn.writtenProgram) {
    const lines = turn.writtenProgram.split("\n");
    console.log(`  program: ${turn.writtenProgram.length} chars, ${lines.length} lines`);
    const showFull = process.env.E2E_SHOW_FULL === "1";
    const cap = showFull ? lines.length : 12;
    for (const l of lines.slice(0, cap)) {
      console.log(`    │ ${l}`);
    }
    if (lines.length > cap) {
      console.log(`    │ ... (${lines.length - cap} more — set E2E_SHOW_FULL=1)`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  turns: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "tip-calculator",
    turns: ["Build me a tip calculator"],
  },
  {
    name: "counter",
    turns: ["Build me a simple counter app"],
  },
  {
    name: "counter-iterate",
    turns: [
      "Build me a simple counter",
      "make the + button green",
      "add a reset button",
    ],
  },
  {
    name: "todo",
    turns: ["Build me a todo list"],
  },
  {
    name: "stopwatch",
    turns: ["Build a stopwatch with start stop reset buttons"],
  },
  {
    name: "dice-roller",
    turns: ["Build me a dice roller with a button that shows a random 1-6"],
  },
  {
    name: "color-picker",
    turns: [
      "Build me an RGB color picker with three sliders showing the current color",
    ],
  },
  {
    name: "quiz",
    turns: [
      "Build me a 3-question trivia quiz about capital cities with a score display",
    ],
  },
  {
    name: "bmi-calc",
    turns: ["Build a BMI calculator: height in cm, weight in kg, show BMI"],
  },
  {
    name: "pomodoro",
    turns: ["Build a pomodoro timer with a 25-minute work timer and start/pause"],
  },
  {
    name: "unit-converter",
    turns: [
      "Build me a celsius to fahrenheit converter with a single input",
    ],
  },
  // ────────────────────────────────────────────────────────────────
  // Harder scenarios — complex state, game logic, nested interactions
  // ────────────────────────────────────────────────────────────────
  {
    name: "tic-tac-toe",
    turns: ["Build me a 3x3 tic-tac-toe game for two players"],
  },
  {
    name: "password-generator",
    turns: [
      "Build a password generator with a length slider and a generate button",
    ],
  },
  {
    name: "habit-tracker",
    turns: [
      "Build a habit tracker where I can add habits and mark them done today",
    ],
  },
  {
    name: "simple-calc",
    turns: ["Build a 4-function calculator (+ - * /)"],
  },
  {
    name: "number-guessing",
    turns: [
      "Build a number guessing game where the computer picks 1-100 and tells me higher or lower",
    ],
  },
  // ────────────────────────────────────────────────────────────────
  // Iteration stress test — multi-turn refinements
  // ────────────────────────────────────────────────────────────────
  {
    name: "tip-calc-iterate",
    turns: [
      "Build me a tip calculator",
      "add a party size input to split the bill",
      "show the per-person total",
    ],
  },
];

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith("--scenario="));
  const allFlag = args.includes("--all");
  const customPrompt = args.find((a) => !a.startsWith("--"));

  // Verify server is up
  try {
    const health = await fetch(`${LLAMA_URL}/health`);
    if (!health.ok) throw new Error("health not ok");
  } catch (err) {
    console.error(
      `Llama server at ${LLAMA_URL} is not responding. ` +
        `Start it with:\n\n  bash scripts/start-llama-server.sh\n`,
    );
    process.exit(2);
  }

  let scenariosToRun: Scenario[];
  if (allFlag) {
    scenariosToRun = SCENARIOS;
  } else if (scenarioArg) {
    const name = scenarioArg.slice("--scenario=".length);
    const found = SCENARIOS.find((s) => s.name === name);
    if (!found) {
      console.error(`Unknown scenario: ${name}`);
      console.error(`Available: ${SCENARIOS.map((s) => s.name).join(", ")}`);
      process.exit(2);
    }
    scenariosToRun = [found];
  } else if (customPrompt) {
    scenariosToRun = [{ name: "custom", turns: [customPrompt] }];
  } else {
    scenariosToRun = [SCENARIOS[0]]; // default: tip calculator
  }

  const summary: Array<{
    scenario: string;
    turn: number;
    userMessage: string;
    status: "ok" | "error";
    errorCode?: string;
  }> = [];

  const maxRetries = parseInt(process.env.E2E_MAX_RETRIES ?? "2", 10);

  for (const scenario of scenariosToRun) {
    console.log(`\n\n${"█".repeat(72)}\nSCENARIO: ${scenario.name}\n${"█".repeat(72)}`);
    const deps = makeMockDeps();
    const chatId = `e2e-${scenario.name}-${Date.now()}`;

    for (let i = 0; i < scenario.turns.length; i++) {
      const userMessage = scenario.turns[i];
      try {
        let finalTurn: TurnResult | null = null;
        let retryAppendix: string | undefined = undefined;
        // Track consecutive patch_mini_app failures so we can strip
        // the tool from the grammar after 2 in a row. Mirrors the
        // production harness dropPatchTool escalation.
        let consecutivePatchFailures = 0;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const dropPatchTool = consecutivePatchFailures >= 2;
          const turn = await runTurn(
            deps,
            chatId,
            userMessage,
            retryAppendix,
            dropPatchTool,
          );
          printTurn(turn, i + 1, attempt);
          finalTurn = turn;
          // Update the consecutive-patch-failures counter based on
          // what this attempt did.
          if (turn.pipelineOutcome === "error" && turn.toolUsed === "patch_mini_app") {
            consecutivePatchFailures++;
          } else {
            consecutivePatchFailures = 0;
          }
          if (turn.pipelineOutcome === "ok") break;
          if (attempt === maxRetries) break;
          // Build a retry hint based on the failure code + message.
          // Patch failures get a strong nudge to switch to write_mini_app,
          // matching the production errorFeedback template.
          const code = turn.pipelineErrorCode ?? "error";
          if (code.startsWith("patch.")) {
            retryAppendix =
              "\n\n--- PATCH FAILED ---\n" +
              (turn.pipelineErrorMessage ?? "") +
              "\n\nRECOMMENDED: switch to write_mini_app and emit the full " +
              "updated program in one shot. Patch matching is whitespace-" +
              "sensitive and hunting for the exact substring on retry is " +
              "unreliable. Copy unchanged lines verbatim from the Current " +
              "program block above and only modify what the user asked for.";
          } else {
            retryAppendix =
              "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
              code +
              ": " +
              (turn.pipelineErrorMessage ?? "") +
              "\n\nAnalyze the error carefully, fix the root cause, and call " +
              "the tool again with a corrected program. Double-check brace " +
              "balance and argument counts.";
          }
        }
        summary.push({
          scenario: scenario.name,
          turn: i + 1,
          userMessage,
          status: finalTurn?.pipelineOutcome ?? "error",
          errorCode: finalTurn?.pipelineErrorCode,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n✗ Turn ${i + 1} threw: ${msg}`);
        summary.push({
          scenario: scenario.name,
          turn: i + 1,
          userMessage,
          status: "error",
          errorCode: "harness_exception",
        });
      }
    }
  }

  // Final summary table
  console.log(`\n\n${"═".repeat(72)}\nSUMMARY\n${"═".repeat(72)}`);
  let okCount = 0;
  let errCount = 0;
  for (const s of summary) {
    const icon = s.status === "ok" ? "✓" : "✗";
    console.log(
      `${icon} ${s.scenario.padEnd(20)} turn ${s.turn}: "${s.userMessage.slice(0, 40)}" → ${s.status}${
        s.errorCode ? " (" + s.errorCode + ")" : ""
      }`,
    );
    if (s.status === "ok") okCount++;
    else errCount++;
  }
  console.log(`\n${okCount} passed, ${errCount} failed`);
  if (errCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
