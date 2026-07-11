// Windows releases directory handles asynchronously, so an rmSync fired the instant after a
// watcher or an SSE stream is closed can hit EBUSY/EPERM/ENOTEMPTY on a throwaway temp dir
// whose handle the OS has not dropped yet (coverage instrumentation, which slows handle
// release, makes this far more likely). Retry with a short backoff, and on the final attempt
// give up quietly: teardown of a temp dir must never turn a test whose assertions already
// passed red, and the OS temp reaper collects any leaked dir later.
import { rmSync } from "node:fs";

const BUSY = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);

export async function rmrf(dir: string, attempts = 10): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !BUSY.has(code) || attempt === attempts - 1) {
        if (attempt === attempts - 1) return; // best-effort on the last try
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
