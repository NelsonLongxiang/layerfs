// Original restricted-launcher process. Data stays on stdio; only its private
// inherited receipt/control pipes name process identity or request cancellation.
import { spawn } from "node:child_process";
export function restrictedProcess(policy, input, path, fail, notStarted) {
  const child = spawn(policy.executable, [policy.sid, path, input.executable, ...input.args], {
    cwd: path, env: input.env, shell: false, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  let pending = "", root = null, pid = null, started = false, beforeEffect = false;
  let cancelled = false, cancelReply = false, closed = false;
  let onStart, onExit, broken = false, original = null;
  const retain = (cause) => {
    if (broken) return; broken = true;
    fail(new Error("restricted original lifecycle failed", { cause: { cause, original, pending } }));
  };
  child.stdio[4].on("error", retain);
  child.stdio[3].on("error", retain);
  child.stdio[3].on("data", (chunk) => {
    if (broken) return;
    original = chunk;
    try {
      if (pending.length + chunk.length > 4096 || chunk.some((b) => b > 127)) throw new Error("restricted receipt window/encoding");
      pending += chunk.toString("ascii");
      for (let end; (end = pending.indexOf("\n")) >= 0;) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let match;
        if ((match = /^LFS_EXEC_STARTED pid=([1-9][0-9]*) restricted=true integrity=low$/.exec(line))) {
          if (started || beforeEffect || root) throw new Error("duplicate restricted start");
          pid = Number(match[1]);
          if (!Number.isSafeInteger(pid) || pid > 0xffffffff || pid === process.pid || pid === child.pid) throw new Error("restricted process identity");
          started = true; onStart(pid);
        } else if ((match = /^LFS_EXEC_CANCEL requested=(true|false)$/.exec(line))) {
          if (!started || !cancelled || cancelReply) throw new Error("restricted cancellation correlation");
          cancelReply = true;
        } else if ((match = /^LFS_EXEC_EXIT code=([0-9]+)$/.exec(line))) {
          const code = Number(match[1]);
          if (!started || root || !Number.isSafeInteger(code) || code > 0xffffffff) throw new Error("restricted exit correlation");
          root = Object.freeze({ exitCode: code, signal: null }); onExit(root);
        } else if ((match = /^LFS_EXEC_FAILED phase=([a-z]+) win32=([0-9]+) started=(true|false)$/.exec(line))) {
          const cause = new Error("restricted launch " + match[1] + " win32 " + match[2]);
          if (!started && !beforeEffect && match[3] === "false") beforeEffect = cause;
          else throw cause;
        } else throw new Error("restricted receipt grammar");
      }
    } catch (cause) { retain(cause); }
  });
  child.stdio[3].on("end", () => {
    if (pending || (!root && !beforeEffect)) retain(new Error("restricted receipt EOF before original outcome"));
  });
  return {
    child,
    observe(start, exit) { onStart = start; onExit = exit; },
    get pid() { return pid; },
    get root() { return root; },
    cancel() {
      if (root) return { requested: false, rootExited: true };
      if (cancelled || closed) throw new Error("restricted cancellation already requested or owner closed");
      cancelled = true;
      // Delivery is not proof of termination. The original exit receipt decides.
      child.stdio[4].write("C", (cause) => { if (cause) retain(cause); });
      return { requested: true, rootExited: false };
    },
    close(code, signal) {
      closed = true;
      if (broken) return false;
      if (beforeEffect && !started && code === 1 && signal === null && !pending) { notStarted(beforeEffect); return false; }
      if (!root || code !== 0 || signal !== null || pending || (cancelled && !cancelReply)) {
        retain(new Error("restricted launcher ended without original process/transport outcome")); return false;
      }
      return true;
    },
  };
}
