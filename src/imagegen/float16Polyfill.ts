// Side-effect module: install Float16Array on globalThis before any other
// module loads.
//
// Hermes (RN 0.83's JS engine) does not yet ship a native Float16Array
// constructor. `onnxruntime-react-native` looks up Float16Array at module-
// init time when building its float16 -> TypedArray dispatch table; if it's
// missing it leaves the slot empty and later throws "TypedArray constructor
// not found: Float16Array" the first time a fp16 tensor crosses the JS
// boundary. The nmkd SD 1.5 ONNX export emits fp16 outputs from the text
// encoder, so we hit this immediately without the polyfill.
//
// Importing this file (as a side-effect-only import from `index.ts`) at the
// very top of the entry chain guarantees the polyfill is in place before
// `onnxruntime-react-native` ever loads, regardless of how Metro/Babel
// orders imports across our other modules.

import { Float16Array, setFloat16 } from "@petamoriken/float16";

const root = globalThis as { Float16Array?: unknown };
if (typeof root.Float16Array === "undefined") {
  root.Float16Array = Float16Array;
}

/**
 * Pack a Float32Array into a Uint16Array of IEEE-754 half-float bits.
 * Used by the image-gen pipeline when feeding fp16-typed ONNX models;
 * `new ort.Tensor("float16", thisOutput, dims)` then sees raw fp16 bits.
 *
 * Uses `setFloat16` from `@petamoriken/float16` so we don't rely on the
 * polyfilled Float16Array proxy's `.buffer` aliasing behavior — direct
 * DataView writes are unambiguous.
 */
export function float32ToFloat16Bits(input: Float32Array): Uint16Array {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    // little-endian; matches every iOS / Android target.
    setFloat16(view, i * 2, input[i], true);
  }
  return new Uint16Array(buf);
}
