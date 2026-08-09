import assert from "node:assert/strict";
import test from "node:test";
import { loggerOptions, sanitizeOperatorMessage } from "../src/logging.js";

test("operator messages redact secrets and IPv4 addresses", () => {
  const sanitized = sanitizeOperatorMessage("token=abc123 failed for 203.0.113.42 with bearer secret-token");
  assert.equal(sanitized, "token=[REDACTED] failed for [REDACTED_IP] with Bearer [REDACTED]");
});

test("request logging serializers do not emit host or remote addresses", () => {
  const incomingRequest: { method: string; url: string; host: string; remoteAddress: string } = {
    method: "GET",
    url: "/api/v1/dashboard",
    host: "dashboard.example:3005",
    remoteAddress: "203.0.113.42",
  };
  const req = loggerOptions.serializers.req(incomingRequest);
  assert.deepEqual(req, {
    method: "GET",
    url: "/api/v1/dashboard",
  });
  assert.doesNotMatch(JSON.stringify(req), /10\.30\.30\.101|203\.0\.113\.42|host|remoteAddress/);
});
