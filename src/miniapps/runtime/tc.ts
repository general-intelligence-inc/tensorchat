/**
 * The `tc` component runtime — exported as a JS string that gets inlined
 * into every mini-app's generated index.html wrapper.
 *
 * The LLM never sees this code. It only sees the PUBLIC API via the
 * system-prompt documentation. This string is the implementation.
 *
 * Core ideas:
 *   - Declarative component descriptors (plain objects) materialized to
 *     real DOM by the runtime.
 *   - Reactive `tc.state` via a Proxy — any mutation schedules a re-render.
 *   - Full re-render on state change (no virtual-DOM diff). Fine for mini-
 *     app scale; the work is <100 nodes per render.
 *   - Per-app `localStorage` wrappers at `tc.save` / `tc.load`. Namespacing
 *     is already automatic via WebView file-origin (each app is a unique
 *     origin because its path is unique).
 *   - Safety: caught exceptions from user code surface a visible banner
 *     instead of silently killing the app. Helps the agent's
 *     self-correction loop see something actionable.
 *
 * Surface (public API that the system prompt documents):
 *
 *   tc.state                            // reactive proxy; mutate to re-render
 *   tc.mount(renderFn)                  // install a () => tree render function
 *   tc.save(key, value)                 // persist JSON-serializable value
 *   tc.load(key)                        // retrieve previously-saved value (or null)
 *
 *   tc.heading({ text, level? })        // 22pt bold, level "lg" | "sm" optional
 *   tc.text({ text, dim? })             // 14pt body text, dim? softer color
 *   tc.display({ text, size? })         // big display panel (calc output feel)
 *   tc.button({ label, onClick, primary?, danger?, disabled? })
 *   tc.input({ value, onInput, placeholder?, type? })   // type: "text" | "number"
 *   tc.row({ gap?, align?, justify?, wrap? }, children)
 *   tc.column({ gap?, align?, justify? }, children)
 *   tc.grid({ columns, gap? }, children)
 *   tc.card({ padding? }, children)
 *   tc.list({ items, render, emptyText? })   // render: (item, i) => tc.*
 *   tc.toggle({ label, value, onChange })
 *   tc.slider({ label?, value, min, max, step?, onChange })
 *
 * Every primitive returns a plain descriptor object; the runtime calls
 * `materialize()` during a render pass to convert it to real DOM.
 */

export const TC_RUNTIME_JS = `
(function() {
  var STATE_KEY = "__tc_state__";
  var stateTarget = Object.create(null);
  var renderFn = null;
  var renderScheduled = false;
  var renderDepth = 0;
  var MAX_RENDER_DEPTH = 32;
  var rootEl = null;
  var errorBannerEl = null;

  // ── reactive state via Proxy ─────────────────────────────────────────
  var state = (typeof Proxy === "function") ? new Proxy(stateTarget, {
    set: function(target, key, value) {
      target[key] = value;
      scheduleRender();
      return true;
    },
    deleteProperty: function(target, key) {
      delete target[key];
      scheduleRender();
      return true;
    }
  }) : stateTarget;  // Proxy always exists in modern WebViews; fallback just for safety.

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    (window.requestAnimationFrame || setTimeout)(function() {
      renderScheduled = false;
      doRender();
    }, 16);
  }

  function doRender() {
    if (!rootEl || !renderFn) return;
    renderDepth++;
    if (renderDepth > MAX_RENDER_DEPTH) {
      renderDepth = 0;
      showError("Render loop detected — your state update probably triggers another state update during render. Break the cycle.");
      return;
    }
    try {
      var tree = renderFn();
      clearChildren(rootEl);
      if (errorBannerEl) rootEl.appendChild(errorBannerEl);
      var node = materialize(tree);
      if (node) rootEl.appendChild(node);
    } catch (err) {
      showError(String(err && err.stack || err && err.message || err));
    } finally {
      renderDepth--;
    }
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function showError(message) {
    if (!rootEl) return;
    if (!errorBannerEl) {
      errorBannerEl = document.createElement("div");
      errorBannerEl.className = "tc-error-banner";
    }
    errorBannerEl.textContent = "Runtime error: " + message;
    if (!errorBannerEl.parentNode) {
      clearChildren(rootEl);
      rootEl.appendChild(errorBannerEl);
    }
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "js-error",
          message: message
        }));
      }
    } catch (e) {}
  }

  // ── component schema validator (mirrors src/miniapps/validator/schema.ts) ─
  //
  // This is a lean in-browser copy of the Node-side registry. Kept in
  // sync by hand — the pair of files is short enough to audit in a
  // single glance. Both surfaces produce IDENTICAL error messages so
  // the model sees the same language whether the failure was caught
  // pre-write (smoke test) or post-write (live render).
  var COMPONENT_SCHEMAS = {
    heading: { props: { text: ["string", true], level: ["enum:lg|sm", false] }, children: false },
    text: { props: { text: ["string", true], dim: ["boolean", false] }, children: false },
    display: { props: { text: ["string|number", true], size: ["enum:lg|sm", false] }, children: false },
    button: {
      props: {
        label: ["string", true],
        onClick: ["function", true],
        primary: ["boolean", false],
        danger: ["boolean", false],
        disabled: ["boolean", false]
      },
      children: false
    },
    input: {
      props: {
        value: ["string|number", false],
        onInput: ["function", true],
        placeholder: ["string", false],
        type: ["enum:text|number", false]
      },
      children: false
    },
    row: {
      props: {
        gap: ["number", false],
        align: ["enum:start|center|end|stretch", false],
        justify: ["enum:start|center|end|between|around", false],
        padding: ["number", false],
        wrap: ["boolean", false]
      },
      children: true
    },
    column: {
      props: {
        gap: ["number", false],
        align: ["enum:start|center|end|stretch", false],
        justify: ["enum:start|center|end|between|around", false],
        padding: ["number", false]
      },
      children: true
    },
    grid: {
      props: { columns: ["number", true], gap: ["number", false] },
      children: true
    },
    card: {
      props: {
        padding: ["number", false],
        gap: ["number", false]
      },
      children: true
    },
    list: {
      props: {
        items: ["any", true],
        render: ["function", true],
        emptyText: ["string", false]
      },
      children: false
    },
    toggle: {
      props: {
        label: ["string", false],
        value: ["boolean", true],
        onChange: ["function", true]
      },
      children: false
    },
    slider: {
      props: {
        label: ["string", false],
        value: ["number", true],
        min: ["number", true],
        max: ["number", true],
        step: ["number", false],
        onChange: ["function", true]
      },
      children: false
    }
  };

  // Alias map for "did you mean" suggestions. Mirrors PROP_ALIASES in
  // src/miniapps/validator/schema.ts — keep in sync.
  var PROP_ALIASES = {
    onPress: "onClick",
    onTap: "onClick",
    secondary: "primary",
    variant: "primary",
    value: "text",
    title: "text",
    content: "text",
    onChange: "onInput",
    onType: "onInput",
    defaultValue: "value",
    checked: "value",
    on: "value",
    min_value: "min",
    max_value: "max",
    gap_size: "gap",
    spacing: "gap"
  };

  // Props to DROP entirely (React/Tailwind/CSS-in-JS) — tc handles
  // styling automatically via the baked-in theme. Mirrors
  // PROPS_TO_REMOVE in validator/schema.ts.
  var PROPS_TO_REMOVE_MAP = {
    style: true,
    className: true,
    "class": true,
    sx: true,
    tw: true,
    css: true
  };

  var COMPONENT_NAMES_LIST = Object.keys(COMPONENT_SCHEMAS).join(", ");

  // Check if a value matches one of the pipe-separated type tokens.
  // Type tokens: "string", "number", "boolean", "function", "any",
  // "string|number", "enum:lg|sm", etc.
  function matchesTypeToken(value, token) {
    if (token === "any") return true;
    if (token.indexOf("enum:") === 0) {
      if (typeof value !== "string") return false;
      var opts = token.slice(5).split("|");
      for (var i = 0; i < opts.length; i++) if (opts[i] === value) return true;
      return false;
    }
    var types = token.split("|");
    for (var j = 0; j < types.length; j++) {
      var t = types[j];
      if (t === "function" && typeof value === "function") return true;
      if (t === "string" && typeof value === "string") return true;
      if (t === "number" && typeof value === "number") return true;
      if (t === "boolean" && typeof value === "boolean") return true;
    }
    return false;
  }

  function typeTokenToHuman(token) {
    if (token.indexOf("enum:") === 0) {
      return "one of: " + token.slice(5).split("|").join(", ");
    }
    return token.replace(/\\|/g, " | ");
  }

  // Validate props on a single descriptor node. Returns the first issue
  // as a user-facing message, or null on success. We return just ONE
  // issue (not a list) because the render pipeline surfaces one banner.
  function validateNodeProps(t, node, path) {
    var spec = COMPONENT_SCHEMAS[t];
    if (!spec) {
      return "Unknown component type \`tc." + t + "\`. The " +
        Object.keys(COMPONENT_SCHEMAS).length +
        " supported primitives are: " + COMPONENT_NAMES_LIST + ".";
    }

    // Unknown props.
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      if (k === "__tc" || k === "children" || k === "__tc_path") continue;
      if (spec.props[k]) continue;
      if (PROPS_TO_REMOVE_MAP[k]) {
        return "tc." + t + " at " + path + ": the \`" + k +
          "\` prop is not supported — the tc runtime handles styling " +
          "via its baked-in theme. DELETE the \`" + k + "\` prop from " +
          "this call. Valid props: " + Object.keys(spec.props).join(", ") + ".";
      }
      var alias = PROP_ALIASES[k];
      var msg = "tc." + t + " at " + path + ": unknown prop \`" + k + "\`.";
      if (alias) msg += " Did you mean \`" + alias + "\`?";
      msg += " Valid props: " + Object.keys(spec.props).join(", ") + ".";
      return msg;
    }

    // Required + type checks.
    for (var pk in spec.props) {
      if (!Object.prototype.hasOwnProperty.call(spec.props, pk)) continue;
      var entry = spec.props[pk];
      var token = entry[0];
      var required = entry[1];
      var val = node[pk];
      var present = val !== undefined && val !== null;
      if (!present) {
        if (required) {
          return "tc." + t + " at " + path + ": missing required prop \`" +
            pk + "\` (" + typeTokenToHuman(token) + ").";
        }
        continue;
      }
      if (!matchesTypeToken(val, token)) {
        return "tc." + t + " at " + path + ": prop \`" + pk +
          "\` must be " + typeTokenToHuman(token) + ", got " + (typeof val) + ".";
      }
    }

    // Children allowed?
    if (node.children !== undefined && !spec.children) {
      return "tc." + t + " at " + path + ": this primitive does not accept " +
        "children. Use a container (tc.row / tc.column / tc.grid / tc.card).";
    }

    return null;
  }

  // ── materialize: descriptor → DOM ────────────────────────────────────
  function materialize(node, path) {
    if (path == null) path = "root";
    if (node == null) return null;
    if (typeof node === "string" || typeof node === "number") {
      return document.createTextNode(String(node));
    }
    if (!node.__tc) {
      // Not a tc descriptor — try to coerce to text.
      return document.createTextNode(String(node));
    }
    var t = node.__tc;

    // Schema validation runs BEFORE the builder. If props are wrong,
    // we surface a specific error banner AND post it to the RN bridge
    // so the harness can feed it back to the model on the next turn.
    var validationMsg = validateNodeProps(t, node, path + "." + t);
    if (validationMsg) {
      showError(validationMsg);
      var errEl = document.createElement("div");
      errEl.className = "tc-error-banner";
      errEl.textContent = validationMsg;
      return errEl;
    }

    var builder = BUILDERS[t];
    if (!builder) {
      var fallback = document.createElement("div");
      fallback.textContent = "[unknown tc component: " + t + "]";
      fallback.style.color = "#EF4444";
      return fallback;
    }
    try {
      // Stash the resolved path on the node so container builders can
      // thread it into materializeChildren for nested tree paths like
      // "root.column.children[0].card.children[1].button".
      node.__tc_path = path + "." + t;
      return builder(node);
    } catch (err) {
      var errEl2 = document.createElement("div");
      errEl2.className = "tc-error-banner";
      errEl2.textContent = "Error rendering " + t + ": " + (err && err.message || err);
      return errEl2;
    }
  }

  function materializeChildren(children, parent, parentPath) {
    if (!children) return;
    if (parentPath == null) parentPath = "";
    if (!Array.isArray(children)) children = [children];
    for (var i = 0; i < children.length; i++) {
      var childPath = parentPath + ".children[" + i + "]";
      var child = materialize(children[i], childPath);
      if (child) parent.appendChild(child);
    }
  }

  // ── primitive builders ──────────────────────────────────────────────
  var BUILDERS = {
    heading: function(n) {
      var el = document.createElement("h2");
      el.className = "tc-heading" +
        (n.level === "lg" ? " tc-heading--lg" : "") +
        (n.level === "sm" ? " tc-heading--sm" : "");
      el.textContent = String(n.text || "");
      return el;
    },

    text: function(n) {
      var el = document.createElement("p");
      el.className = "tc-text" + (n.dim ? " tc-text--dim" : "");
      el.textContent = String(n.text || "");
      return el;
    },

    display: function(n) {
      var el = document.createElement("div");
      el.className = "tc-display" +
        (n.size === "lg" ? " tc-display--lg" : "") +
        (n.size === "sm" ? " tc-display--sm" : "");
      el.textContent = String(n.text == null ? "" : n.text);
      return el;
    },

    button: function(n) {
      var el = document.createElement("button");
      var cls = "tc-btn";
      if (n.primary) cls += " tc-btn--primary";
      if (n.danger) cls += " tc-btn--danger";
      el.className = cls;
      el.textContent = String(n.label == null ? "" : n.label);
      if (n.disabled) el.disabled = true;
      if (typeof n.onClick === "function") {
        el.addEventListener("click", function(e) {
          try { n.onClick(e); } catch (err) { showError("onClick: " + (err && err.message || err)); }
        });
      }
      return el;
    },

    input: function(n) {
      var el = document.createElement("input");
      el.className = "tc-input";
      el.type = n.type || "text";
      if (n.placeholder != null) el.placeholder = String(n.placeholder);
      if (n.value != null) el.value = String(n.value);
      if (typeof n.onInput === "function") {
        el.addEventListener("input", function(e) {
          // Call with the DOM event as the FIRST arg so the common
          // browser pattern function(e) { e.target.value } works. The
          // parsed value is also passed as the second arg as a shortcut
          // for the function(e, v) style.
          try { n.onInput(e, e.target.value); } catch (err) { showError("onInput: " + (err && err.message || err)); }
        });
      }
      return el;
    },

    row: function(n) {
      var el = document.createElement("div");
      el.className = "tc-row";
      applyFlex(el, n);
      if (n.wrap) el.style.flexWrap = "wrap";
      materializeChildren(n.children, el, n.__tc_path);
      return el;
    },

    column: function(n) {
      var el = document.createElement("div");
      el.className = "tc-column";
      applyFlex(el, n);
      materializeChildren(n.children, el, n.__tc_path);
      return el;
    },

    grid: function(n) {
      var el = document.createElement("div");
      el.className = "tc-grid";
      var cols = typeof n.columns === "number" ? n.columns : parseInt(n.columns, 10) || 1;
      el.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
      if (n.gap != null) el.style.gap = gapToCss(n.gap);
      materializeChildren(n.children, el, n.__tc_path);
      return el;
    },

    card: function(n) {
      var el = document.createElement("div");
      el.className = "tc-card";
      if (n.padding != null) el.style.padding = gapToCss(n.padding);
      // Cards accept gap as a convenience (see schema note). Apply
      // it as a flex-column gap so multiple children stack with the
      // requested space between them.
      if (n.gap != null) {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        el.style.gap = gapToCss(n.gap);
      }
      materializeChildren(n.children, el, n.__tc_path);
      return el;
    },

    list: function(n) {
      var el = document.createElement("div");
      el.className = "tc-list";
      var items = Array.isArray(n.items) ? n.items : [];
      if (items.length === 0) {
        var empty = document.createElement("div");
        empty.className = "tc-list--empty";
        empty.textContent = String(n.emptyText || "No items yet.");
        el.appendChild(empty);
        return el;
      }
      if (typeof n.render !== "function") {
        var err = document.createElement("div");
        err.className = "tc-error-banner";
        err.textContent = "tc.list missing render function";
        el.appendChild(err);
        return el;
      }
      for (var i = 0; i < items.length; i++) {
        try {
          var node = materialize(n.render(items[i], i));
          if (node) el.appendChild(node);
        } catch (err2) {
          showError("tc.list render: " + (err2 && err2.message || err2));
          break;
        }
      }
      return el;
    },

    toggle: function(n) {
      var on = !!n.value;
      var el = document.createElement("label");
      el.className = "tc-toggle" + (on ? " tc-toggle--on" : "");
      var track = document.createElement("span");
      track.className = "tc-toggle__track";
      var thumb = document.createElement("span");
      thumb.className = "tc-toggle__thumb";
      track.appendChild(thumb);
      el.appendChild(track);
      if (n.label) {
        var label = document.createElement("span");
        label.className = "tc-toggle__label";
        label.textContent = String(n.label);
        el.appendChild(label);
      }
      el.addEventListener("click", function() {
        try {
          if (typeof n.onChange === "function") n.onChange(!on);
        } catch (err) { showError("toggle onChange: " + (err && err.message || err)); }
      });
      return el;
    },

    slider: function(n) {
      var wrap = document.createElement("div");
      wrap.className = "tc-slider-wrap";
      if (n.label != null) {
        var header = document.createElement("div");
        header.className = "tc-slider-header";
        var l = document.createElement("span");
        l.textContent = String(n.label);
        var v = document.createElement("span");
        v.textContent = String(n.value == null ? "" : n.value);
        header.appendChild(l);
        header.appendChild(v);
        wrap.appendChild(header);
      }
      var el = document.createElement("input");
      el.type = "range";
      el.className = "tc-slider";
      el.min = String(n.min != null ? n.min : 0);
      el.max = String(n.max != null ? n.max : 100);
      if (n.step != null) el.step = String(n.step);
      if (n.value != null) el.value = String(n.value);
      if (typeof n.onChange === "function") {
        el.addEventListener("input", function(e) {
          // DOM event first so function(e) { e.target.value } works;
          // parsed numeric value as the second-arg shortcut.
          try { n.onChange(e, parseFloat(e.target.value)); } catch (err) { showError("slider onChange: " + (err && err.message || err)); }
        });
      }
      wrap.appendChild(el);
      return wrap;
    }
  };

  function applyFlex(el, n) {
    if (n.gap != null) el.style.gap = gapToCss(n.gap);
    if (n.align) el.style.alignItems = mapAlign(n.align);
    if (n.justify) el.style.justifyContent = mapJustify(n.justify);
    if (n.padding != null) el.style.padding = gapToCss(n.padding);
  }

  function mapAlign(v) {
    if (v === "start") return "flex-start";
    if (v === "end") return "flex-end";
    return v;  // "center" / "stretch" pass through
  }
  function mapJustify(v) {
    if (v === "start") return "flex-start";
    if (v === "end") return "flex-end";
    if (v === "between") return "space-between";
    if (v === "around") return "space-around";
    return v;
  }
  function gapToCss(g) {
    if (typeof g === "number") return g + "px";
    return String(g);
  }

  // ── public API: primitive constructors ──────────────────────────────
  function makeDescriptor(type) {
    return function(opts, children) {
      var d = { __tc: type };
      if (opts && typeof opts === "object") {
        for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) d[k] = opts[k];
      }
      if (children !== undefined && d.children === undefined) d.children = children;
      return d;
    };
  }

  var tc = {
    // primitives
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

    // reactive state
    state: state,

    // mount a () => tree render function
    mount: function(fn) {
      if (typeof fn !== "function") {
        showError("tc.mount expects a function, got " + typeof fn);
        return;
      }
      renderFn = fn;
      rootEl = document.getElementById("tc-root");
      if (!rootEl) {
        rootEl = document.createElement("div");
        rootEl.id = "tc-root";
        document.body.appendChild(rootEl);
      }
      doRender();
    },

    // persistence (per-app origin via file-path)
    save: function(key, value) {
      try {
        window.localStorage.setItem(
          STATE_KEY + ":" + String(key),
          JSON.stringify(value)
        );
        return true;
      } catch (e) {
        return false;
      }
    },
    load: function(key) {
      try {
        var raw = window.localStorage.getItem(STATE_KEY + ":" + String(key));
        if (raw == null) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    clear: function(key) {
      try {
        if (key == null) {
          window.localStorage.clear();
        } else {
          window.localStorage.removeItem(STATE_KEY + ":" + String(key));
        }
      } catch (e) {}
    }
  };

  // Expose globally.
  window.tc = tc;

  // Keyboard-aware layout: the on-screen keyboard shrinks visualViewport
  // but not window.innerHeight. We expose the delta as a CSS custom
  // property (--tc-kb-height) that the theme uses as bottom padding on
  // <body> so active inputs stay visible.
  try {
    if (window.visualViewport) {
      var updateKbHeight = function() {
        try {
          var layoutHeight = window.innerHeight;
          var visualHeight = window.visualViewport.height;
          var kb = Math.max(0, layoutHeight - visualHeight);
          document.documentElement.style.setProperty(
            "--tc-kb-height",
            kb + "px"
          );
        } catch (e) {}
      };
      window.visualViewport.addEventListener("resize", updateKbHeight);
      window.visualViewport.addEventListener("scroll", updateKbHeight);
      updateKbHeight();
    }
  } catch (e) {}

  // If the app doesn't call tc.mount() within a frame, show a helpful
  // message instead of a blank screen.
  setTimeout(function() {
    if (!renderFn) {
      var root = document.getElementById("tc-root");
      if (root && !root.firstChild) {
        root.innerHTML = '<div class="tc-error-banner">App did not call tc.mount(). Add tc.mount(function() { return tc.heading({ text: &quot;Hello&quot; }); }); at the end of your program.</div>';
      }
    }
  }, 500);
})();
`;
