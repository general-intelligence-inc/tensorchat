/**
 * Baked-in CSS theme for the `tc` component runtime.
 *
 * This is a string constant that gets inlined into every mini-app's
 * index.html wrapper. The LLM never writes CSS — every tc primitive
 * already has its class styles here, so apps get a consistent visual
 * language "for free".
 *
 * Design direction:
 *   - Dark-first (matches the rest of TensorChat)
 *   - Tabular numerics for display widgets (calculator feel)
 *   - Tap-friendly hit targets on mobile (min 44pt)
 *   - Accent color matches existing ChatGPT-ish theme: #10A37F
 *   - No fancy effects — stays out of the way of the content
 */

export const TC_THEME_CSS = `
:root {
  --tc-bg: #212121;
  --tc-surface: #2F2F2F;
  --tc-surface-hover: #383838;
  --tc-border: #383838;
  --tc-border-subtle: #2A2A2A;
  --tc-text: #ECECEC;
  --tc-text-dim: #8E8EA0;
  --tc-text-faint: #5A5A6E;
  --tc-accent: #10A37F;
  --tc-accent-dim: #0D8A6B;
  --tc-danger: #EF4444;
  --tc-display-bg: #171717;
}

* { box-sizing: border-box; }

html {
  height: 100%;
}

body {
  margin: 0;
  height: 100%;
  background: var(--tc-bg);
  color: var(--tc-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 16px;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
  overflow-x: hidden;
  overflow-y: auto;
  /* Safe-area insets — respected on notched iPhones thanks to
     viewport-fit=cover in the index.html meta tag below. The bottom
     padding ALSO accounts for the on-screen keyboard via the
     --tc-kb-height custom property set by the tc runtime's
     visualViewport listener. */
  padding-top: env(safe-area-inset-top, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--tc-kb-height, 0px));
  padding-left: env(safe-area-inset-left, 0px);
}

#tc-root {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

/* If the user's render returns a single column or card at the root,
   it should fill the available vertical space (push later content
   toward the bottom rather than collapsing to its content height). */
#tc-root > .tc-column:only-child,
#tc-root > .tc-card:only-child {
  flex: 1 0 auto;
}

/* Universal media-overflow guards. Without these, an oversized image
   or canvas inside a tc primitive blows out the layout horizontally. */
img, canvas, video, svg {
  max-width: 100%;
  height: auto;
}

/* ── heading / text ─────────────────────────────────────────────────── */
.tc-heading {
  font-size: 22px;
  font-weight: 700;
  color: var(--tc-text);
  margin: 0;
  line-height: 1.2;
}
.tc-heading--lg { font-size: 28px; }
.tc-heading--sm { font-size: 18px; }

.tc-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--tc-text);
  margin: 0;
}
.tc-text--dim { color: var(--tc-text-dim); }
.tc-text--faint { color: var(--tc-text-faint); }

/* ── display ────────────────────────────────────────────────────────── */
.tc-display {
  font-size: 36px;
  font-weight: 300;
  text-align: right;
  padding: 20px 24px;
  background: var(--tc-display-bg);
  color: var(--tc-text);
  border-radius: 12px;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  min-height: 72px;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-display--lg { font-size: 48px; min-height: 96px; }
.tc-display--sm { font-size: 24px; min-height: 56px; }

/* ── button ─────────────────────────────────────────────────────────── */
.tc-btn {
  appearance: none;
  border: 1px solid var(--tc-border);
  background: var(--tc-surface);
  color: var(--tc-text);
  font-size: 16px;
  font-weight: 500;
  font-family: inherit;
  padding: 14px 18px;
  border-radius: 10px;
  cursor: pointer;
  min-height: 48px;
  transition: background 0.12s, transform 0.08s;
  user-select: none;
  -webkit-user-select: none;
}
.tc-btn:hover { background: var(--tc-surface-hover); }
.tc-btn:active { transform: scale(0.97); }
.tc-btn--primary {
  background: var(--tc-accent);
  border-color: var(--tc-accent);
  color: #fff;
}
.tc-btn--primary:hover { background: var(--tc-accent-dim); }
.tc-btn--danger {
  background: transparent;
  border-color: var(--tc-danger);
  color: var(--tc-danger);
}
.tc-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ── input ──────────────────────────────────────────────────────────── */
.tc-input {
  appearance: none;
  border: 1px solid var(--tc-border);
  background: var(--tc-surface);
  color: var(--tc-text);
  font-size: 16px;
  font-family: inherit;
  padding: 12px 14px;
  border-radius: 8px;
  width: 100%;
  min-height: 44px;
  transition: border-color 0.12s;
}
.tc-input:focus {
  outline: none;
  border-color: var(--tc-accent);
}
.tc-input::placeholder { color: var(--tc-text-faint); }

/* ── layout primitives ──────────────────────────────────────────────── */
.tc-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
}
.tc-column {
  display: flex;
  flex-direction: column;
}
.tc-grid {
  display: grid;
}

/* ── card ───────────────────────────────────────────────────────────── */
.tc-card {
  background: var(--tc-surface);
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  padding: 16px;
}

/* ── list ───────────────────────────────────────────────────────────── */
.tc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tc-list--empty {
  color: var(--tc-text-faint);
  font-size: 13px;
  font-style: italic;
  padding: 20px;
  text-align: center;
}

/* ── toggle (switch) ────────────────────────────────────────────────── */
.tc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.tc-toggle__track {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: var(--tc-surface-hover);
  position: relative;
  transition: background 0.15s;
}
.tc-toggle__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background: #fff;
  transition: transform 0.18s ease;
}
.tc-toggle--on .tc-toggle__track { background: var(--tc-accent); }
.tc-toggle--on .tc-toggle__thumb { transform: translateX(18px); }
.tc-toggle__label {
  font-size: 14px;
  color: var(--tc-text);
}

/* ── slider (range input) ───────────────────────────────────────────── */
.tc-slider-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tc-slider-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--tc-text-dim);
}
.tc-slider {
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--tc-surface-hover);
  outline: none;
}
.tc-slider::-webkit-slider-thumb {
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--tc-accent);
  border: 2px solid var(--tc-bg);
  cursor: pointer;
}
.tc-slider::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--tc-accent);
  border: 2px solid var(--tc-bg);
  cursor: pointer;
}

/* ── error banner (runtime-injected) ────────────────────────────────── */
.tc-error-banner {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid var(--tc-danger);
  color: var(--tc-danger);
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  margin-bottom: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
`;
