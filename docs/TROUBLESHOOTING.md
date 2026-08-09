# Troubleshooting

Start with the process error, then check liveness, readiness, and the affected
panel. Avoid dumping the full environment or raw upstream responses: either can
contain credentials or personal data.

## Configuration file cannot be read or parsed

- Confirm `RAVENHILL_CONFIG` points to a readable file.
- Validate YAML indentation and duplicate keys.
- Keep `schema_version: 1` at the document root.
- Remove unknown fields; the schema is intentionally strict.
- Start from `ravenhill.example.yml` rather than an old deployment file.

The container default is `/etc/ravenhill/ravenhill.yml`.

## A secret is missing or ambiguous

For a reference such as `TELEVISION_API_KEY`, set exactly one of
`TELEVISION_API_KEY` or `TELEVISION_API_KEY_FILE`. The file form must contain a
non-empty value and be readable by the unprivileged service user. Do not print
the file while diagnosing permissions.

If the failing secret belongs to a collector that should be disabled, remove
that collector row. If it belongs to the energy sidecar, inject it only into
that service.

## Liveness succeeds but readiness returns 503

`/health/live` proves the process is serving. `/health/ready` waits until every
configured collector with `required: true` has attempted at least once. Check:

- collector URL and read-only permissions;
- timeout versus upstream response time;
- TLS trust when `tls_verify` remains enabled;
- configured selector names and IDs; and
- whether the collector should be `required: false` or omitted.

Do not disable TLS verification merely to hide an unrelated connection error.

## A panel is disabled, stale, degraded, or error

- `disabled`: no collector maps to that panel.
- `stale`: last-good data exists but is older than the configured threshold.
- `degraded`: a bounded subset remains usable while another sub-read failed.
- `error`: the collector has no usable current or last-good result.

Failures are isolated. Diagnose the named source without restarting unrelated
collectors. Increasing `stale_after_seconds` changes presentation of old data;
it does not repair collection.

## Demo query returns 400

The selector must be one of `healthy`, `empty`, `stale`, `degraded`,
`collector-failure`, or `privacy`. Query selection is allowed only when the
server itself is in demo mode. Live mode rejects it by design.

## The energy panel is unavailable

Verify the sidecar's `GET /health`, the dashboard `energy` collector URL, the
top-level `energy` section, the configured timezone, and the sidecar-only
secret files. Every calendar month must appear exactly once across the rate
seasons. The sidecar listens on port 8080 by default.

## Posters do not render

The Radarr instance ID in the route must match a configured Radarr collector,
and the movie ID must be numeric. Ravenhill rejects redirects, oversized
responses, and content types outside AVIF, WebP, JPEG, and PNG. The movie card
continues to render without an image when the relay is unavailable.

## Browser data looks private in public mode

Public mode replaces displayed usernames only. The API still contains the
normalized identity and coarse location. This is expected; restrict access at
the network/authentication boundary if a user must not see the response.

## Safe diagnostic sequence

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --silent --show-error http://127.0.0.1:3000/health/ready
curl --silent --show-error http://127.0.0.1:3000/api/v1/configuration
```

Inspect only the affected normalized panel after those checks. Never attach a
full environment, secret file, raw collector payload, or live screenshot to a
public report.
