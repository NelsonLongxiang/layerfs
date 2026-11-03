// fs.write: one positional SDK operation. Text is `content`; anything else
// is `bytes` (see body.js). The last argument is a message or
// `{ message, mode }`.
import { writeOptions } from "../client.js";
import { body, emptyBinary } from "./body.js";
export function write(client, branch, path, content, options) {
  const value = emptyBinary(content) ? { content: "" } : typeof content === "string" ? { content } : { bytes: body(content) };
  return client.call("fs.write", { branch, path, ...value, ...writeOptions(options) });
}