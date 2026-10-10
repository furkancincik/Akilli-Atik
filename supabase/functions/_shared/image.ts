import { AnalysisError } from "./analysis.ts";
export const MAX_ANALYSIS_BYTES = 5 * 1024 * 1024;
export async function readLimitedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  code: "INVALID_PHOTO" | "INVALID_RESPONSE" = "INVALID_PHOTO",
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) throw new AnalysisError(code);
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new AnalysisError("TIMEOUT");
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new AnalysisError("TIMEOUT");
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AnalysisError(code);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
// Checks JPEG structure/dimensions before forwarding. Gemini still decodes the image.
export function validateAnalysisImage(bytes: Uint8Array): void {
  const invalid = () => {
    throw new AnalysisError("INVALID_PHOTO");
  };
  if (
    !bytes.length ||
    bytes.length > MAX_ANALYSIS_BYTES ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    invalid();
  let offset = 2;
  let dimensions = false;
  let scan = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8) invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) invalid();
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (!width || !height || width > 1600 || height > 1600) invalid();
      dimensions = true;
    }
    if (marker === 0xda) {
      scan = true;
      break;
    }
    offset += length;
  }
  if (!dimensions || !scan) invalid();
}
