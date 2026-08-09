const SECRET_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key|apikey)=?[^\s&,]*/gi;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+\/-]+=*/gi;
const VIEWER_IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function sanitizeOperatorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(SECRET_PATTERN, "$1=[REDACTED]")
    .replace(VIEWER_IP_PATTERN, "[REDACTED_IP]")
    .slice(0, 240);
}

export const loggerOptions = {
  serializers: {
    req(request: { method?: string; url?: string }) {
      return {
        method: request.method ?? "UNKNOWN",
        url: request.url ?? "/",
      };
    },
    res(reply: { statusCode?: number }) {
      return {
        statusCode: reply.statusCode ?? 0,
      };
    },
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-api-key",
      "request.headers.authorization",
      "request.headers.cookie",
      "request.headers.x-api-key",
      "password",
      "token",
      "apiKey",
    ],
    censor: "[REDACTED]",
  },
};
