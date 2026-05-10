/**
 * Minimal 24-bit BMP V3 writer for the image-generation pipeline.
 *
 * The diffusion VAE produces a Float32 RGB tensor in [-1, 1]; we convert to
 * uint8 [0, 255] and pack into BMP. Both iOS (UIImage) and Android
 * (BitmapFactory) decode BMP natively, so React Native's <Image> renders
 * the resulting .bmp file with no extra plumbing.
 *
 * V1 deliberately uses BMP instead of PNG to avoid pulling in a JS zlib
 * dependency (~7 KB minified but extra surface area for now). BMP files
 * are roughly 2× the size of equivalent PNG; we accept that trade for
 * simpler code today.
 *
 * Format reference: https://en.wikipedia.org/wiki/BMP_file_format
 *   BITMAPFILEHEADER (14 bytes) + BITMAPINFOHEADER (40 bytes)
 *   + bottom-up BGR pixel data (rows 4-byte aligned).
 */

import RNFS from "react-native-fs";

/**
 * Convert a Float32 RGB tensor in CHW format ([3, H, W], values in [-1, 1])
 * into a BGR uint8 buffer in BMP layout (bottom-up, 4-byte row alignment).
 *
 * The VAE output for SD 1.5 is shape [1, 3, H, W] in [-1, 1]; the caller
 * should pass the [3, H, W] slice directly.
 */
function tensorToBmpBgrBuffer(
  rgb: Float32Array,
  width: number,
  height: number,
): Uint8Array {
  const planeSize = width * height;
  if (rgb.length !== 3 * planeSize) {
    throw new Error(
      `BMP writer expects [3, ${height}, ${width}] = ${3 * planeSize} floats, got ${rgb.length}`,
    );
  }

  // Each row is width*3 bytes, padded up to a multiple of 4.
  const rowStride = (width * 3 + 3) & ~3;
  const pixelBytes = rowStride * height;
  const fileSize = 14 + 40 + pixelBytes;

  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  // -- BITMAPFILEHEADER (14 bytes, little-endian) --
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true); // total file size
  view.setUint16(6, 0, true); // reserved
  view.setUint16(8, 0, true); // reserved
  view.setUint32(10, 14 + 40, true); // pixel data offset (54)

  // -- BITMAPINFOHEADER (40 bytes) --
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true); // width
  view.setInt32(22, height, true); // height (positive = bottom-up)
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(30, 0, true); // compression (BI_RGB = none)
  view.setUint32(34, pixelBytes, true); // image size
  view.setInt32(38, 2835, true); // x pixels per meter (~72 dpi)
  view.setInt32(42, 2835, true); // y pixels per meter
  view.setUint32(46, 0, true); // colors used
  view.setUint32(50, 0, true); // important colors

  // -- Pixel data: BMP rows are bottom-up, BGR order --
  const pixOffset = 54;
  for (let y = 0; y < height; y++) {
    // BMP row 0 is the BOTTOM row, so flip Y.
    const srcY = height - 1 - y;
    const rowStart = pixOffset + y * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = srcY * width + x;
      // Tensor is CHW: r at idx, g at idx + planeSize, b at idx + 2*planeSize.
      const r = rgb[srcIdx];
      const g = rgb[planeSize + srcIdx];
      const b = rgb[2 * planeSize + srcIdx];
      const dst = rowStart + x * 3;
      // [-1, 1] -> [0, 255], BGR order.
      buf[dst] = clampByte((b + 1.0) * 127.5);
      buf[dst + 1] = clampByte((g + 1.0) * 127.5);
      buf[dst + 2] = clampByte((r + 1.0) * 127.5);
    }
    // Trailing row padding (already zero-initialized).
  }

  return buf;
}

function clampByte(x: number): number {
  if (x < 0) return 0;
  if (x > 255) return 255;
  return x | 0;
}

/**
 * Encode an RGB Float32 tensor in CHW layout to a BMP file on disk.
 * Returns the absolute path (without `file://` prefix) of the written file.
 */
export async function writeRgbTensorAsBmp(
  rgb: Float32Array,
  width: number,
  height: number,
  destPath: string,
): Promise<string> {
  const bmpBuffer = tensorToBmpBgrBuffer(rgb, width, height);
  // RNFS.writeFile with 'base64' encoding is the most portable way to
  // write arbitrary binary bytes from a Uint8Array — base64 conversion
  // is a one-time cost (~1.3× memory, fast) and avoids native-bridge
  // edge cases with raw ArrayBuffer encoding on older RN versions.
  const base64 = uint8ArrayToBase64(bmpBuffer);
  await RNFS.writeFile(destPath, base64, "base64");
  return destPath;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Avoids the call-stack-overflow that affects String.fromCharCode(...arr)
  // for large arrays (a 786 KB BMP comfortably exceeds spread-arg limits).
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  // global.btoa is available in React Native (Hermes provides it).
  // Fall back to manual encoding if not (should never trigger on RN).
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }
  return manualBtoa(binary);
}

function manualBtoa(input: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 0x3f];
    out += chars[(triple >> 12) & 0x3f];
    out += i + 1 < input.length ? chars[(triple >> 6) & 0x3f] : "=";
    out += i + 2 < input.length ? chars[triple & 0x3f] : "=";
  }
  return out;
}
