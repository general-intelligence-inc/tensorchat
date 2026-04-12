/**
 * Realistic Gemma-output fixtures for the local mini-app test harness.
 *
 * These are hand-crafted or observed LLM outputs that represent the
 * failure modes we've actually seen in production logs, plus a set
 * of edge cases small models often trip over (arrow functions,
 * template literals, unicode math symbols, mistaken React-isms, etc).
 *
 * Each fixture is tagged with its expected outcome:
 *   - "ok": pipeline should write it successfully
 *   - a ValidationCode string: pipeline should reject with that code
 *
 * Adding a new fixture here is the cheapest way to lock in a fix:
 *   1. Paste the problem output
 *   2. Specify the expected ValidationCode
 *   3. Run `npm run test:miniapp` — watch it fail
 *   4. Fix the pipeline/validator until it passes
 */

export interface MiniAppFixture {
  name: string;
  rawProgram: string;
  /** Either "ok" or a ValidationCode (partial match on the code prefix works too). */
  expected: string;
  /** Human-readable note about what this fixture exercises. */
  note?: string;
}

export const FIXTURES: MiniAppFixture[] = [
  // ────────────────────────────────────────────────────────────────
  // Real production failures (from user-pasted logs)
  // ────────────────────────────────────────────────────────────────

  {
    name: "empty-program-field",
    rawProgram: "",
    expected: "args.missing_program",
    note: "Grammar-constrained gen produced no program field at all",
  },
  {
    name: "fence-only",
    rawProgram: "```javascript\n```",
    expected: "clean.empty",
    note: "Model wrapped an empty fence",
  },
  {
    name: "label-only",
    rawProgram: "[js]",
    expected: "clean.empty",
    note: "Model only emitted a label marker",
  },
  {
    name: "whitespace-only",
    rawProgram: "   \n\n   ",
    expected: "clean.empty",
    note: "Model emitted whitespace only",
  },

  // ────────────────────────────────────────────────────────────────
  // Valid programs (tip calculator, counter, todo)
  // ────────────────────────────────────────────────────────────────

  {
    name: "minimal-hello",
    rawProgram: `tc.mount(function(){ return tc.heading({ text: "Hello" }); });`,
    expected: "ok",
    note: "Smallest possible valid program",
  },
  {
    name: "counter-canonical",
    rawProgram: `tc.state.count = tc.load("count") || 0;
tc.mount(function() {
  return tc.column({ gap: 20, padding: 24 }, [
    tc.heading({ text: "Counter", level: "lg" }),
    tc.display({ text: String(tc.state.count) }),
    tc.row({ gap: 12 }, [
      tc.button({ label: "−", onClick: function() { tc.state.count = tc.state.count - 1; tc.save("count", tc.state.count); } }),
      tc.button({ label: "+", primary: true, onClick: function() { tc.state.count = tc.state.count + 1; tc.save("count", tc.state.count); } }),
      tc.button({ label: "reset", onClick: function() { tc.state.count = 0; tc.save("count", 0); } })
    ])
  ]);
});`,
    expected: "ok",
    note: "The canonical counter from the system prompt",
  },
  {
    name: "tip-calculator-complete",
    rawProgram: `tc.state.bill = tc.load("bill") || 0;
tc.state.tipPct = tc.load("tipPct") || 15;

tc.mount(function() {
  var bill = tc.state.bill;
  var pct = tc.state.tipPct;
  var tip = bill * pct / 100;
  var total = bill + tip;
  return tc.column({ gap: 20, padding: 24 }, [
    tc.heading({ text: "Tip Calculator", level: "lg" }),
    tc.card({ padding: 16 }, [
      tc.column({ gap: 12 }, [
        tc.text({ text: "Bill amount" }),
        tc.input({
          type: "number",
          value: String(bill),
          onInput: function(e) {
            tc.state.bill = parseFloat(e.target.value) || 0;
            tc.save("bill", tc.state.bill);
          }
        }),
        tc.text({ text: "Tip %: " + pct }),
        tc.slider({
          value: pct, min: 0, max: 30, step: 1,
          onChange: function(e) {
            tc.state.tipPct = parseFloat(e.target.value) || 0;
            tc.save("tipPct", tc.state.tipPct);
          }
        }),
        tc.display({ text: "Tip: $" + tip.toFixed(2) }),
        tc.display({ text: "Total: $" + total.toFixed(2), size: "lg" })
      ])
    ])
  ]);
});`,
    expected: "ok",
    note: "A real tip calculator — the exact app the user was trying to build",
  },
  {
    name: "todo-list",
    rawProgram: `tc.state.items = tc.load("items") || [];
tc.state.draft = "";

tc.mount(function() {
  return tc.column({ gap: 16, padding: 20 }, [
    tc.heading({ text: "Todos", level: "lg" }),
    tc.row({ gap: 8 }, [
      tc.input({
        value: tc.state.draft,
        placeholder: "New item",
        onInput: function(e) { tc.state.draft = e.target.value; }
      }),
      tc.button({
        label: "Add",
        primary: true,
        onClick: function() {
          if (!tc.state.draft) return;
          tc.state.items = tc.state.items.concat([tc.state.draft]);
          tc.state.draft = "";
          tc.save("items", tc.state.items);
        }
      })
    ]),
    tc.list({
      items: tc.state.items,
      emptyText: "No todos yet",
      render: function(item, i) {
        return tc.row({ gap: 8 }, [
          tc.text({ text: item }),
          tc.button({
            label: "x",
            danger: true,
            onClick: function() {
              tc.state.items = tc.state.items.filter(function(_, j) { return j !== i; });
              tc.save("items", tc.state.items);
            }
          })
        ]);
      }
    })
  ]);
});`,
    expected: "ok",
    note: "A todo list using tc.list with dynamic render fn",
  },

  // ────────────────────────────────────────────────────────────────
  // Small-model common mistakes
  // ────────────────────────────────────────────────────────────────

  {
    name: "secondary-prop-mistake",
    rawProgram: `tc.mount(function() {
  return tc.button({ label: "Cancel", secondary: true, onClick: function() {} });
});`,
    expected: "smoke.render_invalid_tree",
    note: "Model confuses `secondary` with `primary` (React convention)",
  },
  {
    name: "onPress-instead-of-onClick",
    rawProgram: `tc.mount(function() {
  return tc.button({ label: "Tap", onPress: function() {} });
});`,
    expected: "smoke.render_invalid_tree",
    note: "React Native muscle memory — onPress not onClick",
  },
  {
    name: "unknown-component-tc-table",
    rawProgram: `tc.mount(function() {
  return tc.table({ rows: [] });
});`,
    expected: "smoke.render_invalid_tree",
    note: "Model invents a tc.table primitive that doesn't exist",
  },
  {
    name: "mount-in-conditional",
    rawProgram: `if (typeof tc !== "undefined") {
  tc.mount(function() { return tc.heading({ text: "Conditional" }); });
}`,
    expected: "static.conditional_mount",
    note: "Model wraps tc.mount inside an if-block",
  },
  {
    name: "mount-missing-entirely",
    rawProgram: `tc.state.x = 42;
var render = function() { return tc.heading({ text: "Forgot to mount" }); };
// render();  // commented out — nothing mounts`,
    expected: "static.no_mount",
    note: "Render fn defined but tc.mount never called",
  },
  {
    name: "script-tag-infection",
    rawProgram: `<script>
tc.mount(function() { return tc.heading({ text: "Oops" }); });
</script>`,
    expected: "static.html_tags",
    note: "Model wrote an HTML <script> tag around the program",
  },
  {
    name: "body-tag-infection",
    rawProgram: `<body>
tc.mount(function() { return tc.heading({ text: "Oops" }); });
</body>`,
    expected: "static.html_tags",
    note: "Model wrote <body> tags",
  },

  // ────────────────────────────────────────────────────────────────
  // JavaScript flavor edge cases
  // ────────────────────────────────────────────────────────────────

  {
    name: "arrow-function-render",
    rawProgram: `tc.state.count = 0;
tc.mount(() => tc.column({ gap: 16 }, [
  tc.heading({ text: "Counter" }),
  tc.button({ label: "+", onClick: () => { tc.state.count++; } })
]));`,
    expected: "ok",
    note: "Arrow function syntax should work (ES6+)",
  },
  {
    name: "template-literal",
    rawProgram: `tc.state.n = 0;
tc.mount(function() {
  return tc.column({ gap: 16 }, [
    tc.display({ text: \`Count: \${tc.state.n}\` }),
    tc.button({ label: "+", onClick: function() { tc.state.n++; } })
  ]);
});`,
    expected: "ok",
    note: "Template literals should work",
  },
  {
    name: "unicode-minus-sign",
    rawProgram: `tc.state.n = 0;
tc.mount(function() {
  return tc.row({ gap: 8 }, [
    tc.button({ label: "−", onClick: function() { tc.state.n--; } }),
    tc.button({ label: "＋", onClick: function() { tc.state.n++; } })
  ]);
});`,
    expected: "ok",
    note: "Unicode en-dash and fullwidth plus in button labels",
  },
  {
    name: "let-const-declarations",
    rawProgram: `let baseState = 0;
const MULTIPLIER = 2;
tc.state.count = baseState;
tc.mount(function() {
  return tc.button({
    label: "×" + MULTIPLIER,
    onClick: function() { tc.state.count = tc.state.count * MULTIPLIER; }
  });
});`,
    expected: "ok",
    note: "let/const at top level (strict-mode safe)",
  },
  {
    name: "truncated-midway",
    rawProgram: `tc.state.count = 0;
tc.mount(function() {
  return tc.column({ gap: 16 }, [
    tc.heading({ text: "Counter" }),
    tc.button({ label: "+", onClick: function() { tc.state.count++;`,
    expected: "parse.syntax_error",
    note: "Program truncated mid-statement (hit token cap)",
  },

  // ────────────────────────────────────────────────────────────────
  // Fences around otherwise valid programs
  // ────────────────────────────────────────────────────────────────

  {
    name: "valid-program-in-fences",
    rawProgram: `\`\`\`javascript
tc.mount(function() { return tc.heading({ text: "Hi" }); });
\`\`\``,
    expected: "ok",
    note: "Fenced but non-empty program should unwrap and succeed",
  },
  {
    name: "valid-program-with-js-label",
    rawProgram: `[js]
tc.mount(function() { return tc.heading({ text: "Hi" }); });`,
    expected: "ok",
    note: "Label prefix should be stripped",
  },

  // ────────────────────────────────────────────────────────────────
  // Edge cases likely to catch bugs
  // ────────────────────────────────────────────────────────────────

  {
    name: "text-with-lt-character",
    rawProgram: `tc.mount(function() {
  return tc.text({ text: "Angle: 45 < 90" });
});`,
    expected: "ok",
    note: "Text content with literal `<` — must NOT trip the HTML tag regex",
  },
  {
    name: "comparison-operator-in-logic",
    rawProgram: `tc.state.n = 0;
tc.mount(function() {
  return tc.column({}, [
    tc.text({ text: tc.state.n < 10 ? "low" : "high" }),
    tc.button({ label: "+", onClick: function() { tc.state.n++; } })
  ]);
});`,
    expected: "ok",
    note: "Ternary with `<` comparison — regex must not false-positive",
  },
  {
    name: "jsx-like-string",
    rawProgram: `tc.mount(function() {
  return tc.text({ text: "No <script> allowed" });
});`,
    expected: "static.html_tags",
    note:
      "A string LITERAL containing <script> trips the HTML regex — acceptable " +
      "false positive because we want to block actual script injection.",
  },
  {
    name: "number-literal-with-lt",
    rawProgram: `var threshold = 100;
tc.mount(function() {
  return tc.text({ text: "n < " + threshold });
});`,
    expected: "ok",
    note: "String concatenation involving `<`",
  },
  {
    name: "heading-with-numeric-text",
    rawProgram: `tc.mount(function() {
  return tc.heading({ text: 42 });
});`,
    expected: "smoke.render_invalid_tree",
    note: "heading.text is required to be a string, not a number",
  },
  {
    name: "heading-with-number-coerced-in-prompt",
    rawProgram: `tc.mount(function() {
  return tc.heading({ text: String(42) });
});`,
    expected: "ok",
    note: "Using String() to coerce — the correct pattern",
  },
  {
    name: "display-accepts-number",
    rawProgram: `tc.mount(function() {
  return tc.display({ text: 42 });
});`,
    expected: "ok",
    note: "display.text accepts string | number (spec allows it)",
  },
  {
    name: "button-missing-onClick",
    rawProgram: `tc.mount(function() {
  return tc.button({ label: "Broken" });
});`,
    expected: "smoke.render_invalid_tree",
    note: "button.onClick is required",
  },
  {
    name: "input-missing-onInput",
    rawProgram: `tc.mount(function() {
  return tc.input({ value: "" });
});`,
    expected: "smoke.render_invalid_tree",
    note: "input.onInput is required",
  },
  {
    name: "grid-missing-columns",
    rawProgram: `tc.mount(function() {
  return tc.grid({}, [
    tc.text({ text: "a" }),
    tc.text({ text: "b" })
  ]);
});`,
    expected: "smoke.render_invalid_tree",
    note: "grid.columns is required",
  },
  {
    name: "slider-valid-range",
    rawProgram: `tc.state.vol = 50;
tc.mount(function() {
  return tc.slider({
    value: tc.state.vol, min: 0, max: 100, step: 5,
    onChange: function(e) { tc.state.vol = parseFloat(e.target.value) || 0; }
  });
});`,
    expected: "ok",
    note: "Slider with all required props set",
  },
  {
    name: "list-with-empty-array",
    rawProgram: `tc.state.items = [];
tc.mount(function() {
  return tc.list({
    items: tc.state.items,
    emptyText: "nothing here",
    render: function(x) { return tc.text({ text: x }); }
  });
});`,
    expected: "ok",
    note: "Empty list with emptyText — render fn never called",
  },
  {
    name: "children-on-leaf-component",
    rawProgram: `tc.mount(function() {
  return tc.button({
    label: "Bad",
    onClick: function() {},
    children: [tc.text({ text: "shouldnt be here" })]
  });
});`,
    expected: "smoke.render_invalid_tree",
    note: "button does not accept children",
  },
  {
    name: "nested-deep-tree",
    rawProgram: `tc.mount(function() {
  return tc.column({ gap: 8 }, [
    tc.card({ padding: 12 }, [
      tc.row({ gap: 8 }, [
        tc.column({ gap: 4 }, [
          tc.heading({ text: "Deep", level: "sm" }),
          tc.text({ text: "nested" })
        ]),
        tc.button({ label: "x", onClick: function() {} })
      ])
    ])
  ]);
});`,
    expected: "ok",
    note: "Deeply nested valid tree — tree path threading should work",
  },
  {
    name: "multiline-find-patch-candidate",
    rawProgram: `tc.state.count = 0;
/*
 * Multi-line block comment
 * with various characters:
 *   < > { } [ ] ( )
 */
tc.mount(function() {
  return tc.heading({ text: "Commented" });
});`,
    expected: "ok",
    note: "Multi-line block comment with special chars in it",
  },
  {
    name: "large-but-valid-program",
    rawProgram:
      `tc.state.items = [\n` +
      Array.from({ length: 50 }, (_, i) => `  "item ${i}"`).join(",\n") +
      `\n];\n` +
      `tc.mount(function() {\n` +
      `  return tc.list({\n` +
      `    items: tc.state.items,\n` +
      `    render: function(x) { return tc.text({ text: x }); }\n` +
      `  });\n` +
      `});`,
    expected: "ok",
    note: "Large-but-valid (~1KB) — should pass size check and smoke test",
  },
  {
    name: "program-exceeds-size-cap",
    rawProgram: "// " + "x".repeat(19_000) + "\ntc.mount(function(){});",
    expected: "static.program_too_big",
    note: "Program over MAX_PROGRAM_CHARS",
  },
  {
    name: "tc-mount-inside-string",
    rawProgram: `var docs = "remember to call tc.mount(renderFn) at the end";
var other = 42;`,
    expected: "smoke.no_mount",
    note:
      "The regex `tc.mount(` matches against string literals too, so the " +
      "static check lets this through. Smoke test catches the REAL bug " +
      "(mount was never called at runtime). Either path gives the model a " +
      "crisp 'add tc.mount at the end' retry message.",
  },
];
