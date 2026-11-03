// A write's binary body. Any typed array, DataView or ArrayBuffer becomes a
// Buffer over the same memory, without a copy, so every route takes it: the
// binding reads any view as bytes, but the worker's encoding carries only
// Buffer, Uint8Array and ArrayBuffer. The binding copies the bytes when the
// call starts, after this client's Store is open, so the caller must not
// change them until the call settles. Memory another thread can change
// (SharedArrayBuffer) and a transferred (detached) ArrayBuffer are refused.
// Other values pass unchanged. A zero-length binary body travels as empty text:
// napi 2.16.17's JsBuffer::into_value builds a Vec from a NULL pointer when
// Node reports a zero-length buffer, which aborts the process, and that crate
// is third-party and stays unpatched; the empty file is the same either way.
import { types } from "node:util";
import { LayerFSError } from "../errors.js";

const refused = (what) => new LayerFSError("InvalidInput", `write bytes ${what} are not accepted`, null);

/** Whether value is binary (a typed array, DataView or ArrayBuffer). */
const binary = (value) => ArrayBuffer.isView(value) || types.isAnyArrayBuffer(value);

/** A binary body with no bytes; it is sent as empty text instead of bytes. */
export const emptyBinary = (value) => binary(value) && value.byteLength === 0;

/** value as a Buffer when it is binary, else value itself. */
export function body(value) {
  const view = ArrayBuffer.isView(value);
  if (!view && !types.isAnyArrayBuffer(value)) return value;
  const memory = view ? value.buffer : value;
  if (types.isSharedArrayBuffer(memory)) throw refused("in shared memory (SharedArrayBuffer)");
  if (memory.detached) throw refused("in a detached ArrayBuffer");
  if (Buffer.isBuffer(value)) return value;
  try {
    return view ? Buffer.from(memory, value.byteOffset, value.byteLength) : Buffer.from(memory);
  } catch {
    // Node 20 has no detached flag; a detached buffer or view throws here.
    throw refused("in a detached ArrayBuffer");
  }
}

/** One fs.apply change with its write body as fs.write sends it: binary
 * content travels as bytes (empty binary as empty text, see above). */
export function change(c) {
  if (c?.op !== "write") return c;
  if (emptyBinary(c.content)) return { ...c, content: "" };
  if (emptyBinary(c.bytes)) {
    const { bytes, ...rest } = c;
    return { ...rest, content: "" };
  }
  if (c.content !== undefined && typeof c.content !== "string" && c.bytes === undefined) {
    const { content, ...rest } = c;
    return { ...rest, bytes: body(content) };
  }
  return c.bytes === undefined ? c : { ...c, bytes: body(c.bytes) };
}
