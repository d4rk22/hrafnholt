import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);

test("aborting an in-flight UPS request does not exit the process", async () => {
  const fixture = fileURLToPath(new URL("./ups-abort-fixture.ts", import.meta.url));
  // The double-close throw escapes uncaughtException, so the only reliable
  // signal is the child's exit status.
  const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", fixture]);
  assert.doesNotMatch(stdout + stderr, /ERR_SOCKET_DGRAM_NOT_RUNNING/);
});
