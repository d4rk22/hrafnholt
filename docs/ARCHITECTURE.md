# Architecture

Ravenhill separates configuration, collection, normalization, and
presentation so one upstream failure does not erase unrelated dashboard data.

```text
ravenhill.yml ──> strict configuration validation
                         │
secret references ──> service-scoped resolver
                         │
                         v
collectors ──> scheduler ──> last-good snapshot store ──> Fastify API
                                                               │
optional energy sidecar ────────────────────────────────────────┘
                                                               │
                                                               v
                                                   same-origin browser UI
```

## Runtime components

### Dashboard service

The Node.js 24 service uses Fastify for static files and JSON routes. Startup
parses `ravenhill.yml`, rejects duplicate YAML keys and unsupported fields,
validates the versioned schema, and resolves only the secret references used by
configured collectors. A configuration or required-secret error stops the
process before it listens.

In live mode, the scheduler gives each collector its own interval, timeout,
stale threshold, and abort signal. A successful result replaces that panel's
last-good value. A later failure changes only that panel: current data may
remain visible as stale while the error is reported. Required collectors affect
readiness only after the operator explicitly configures them.

The snapshot store is in memory. The UniFi collector may optionally use an
operator-selected absolute state path for bounded rate-history state; Ravenhill
does not otherwise require a database.

### Energy sidecar

The Python sidecar reads only `presentation.timezone` and the top-level
`energy` section. It independently validates those fields, resolves only the
configured energy credentials, polls the selected provider, and exposes
`GET /health` and `GET /energy` on port 8080. It has no browser-facing port in
the recommended topology; the dashboard reaches it through an explicitly
configured `energy` collector URL.

### Browser application

The browser loads static HTML, CSS, and JavaScript from the dashboard origin
and requests only Ravenhill routes. It renders normalized panel envelopes,
never talks directly to collector services, and makes no third-party map, font,
script, or analytics request. Radarr posters, when enabled, pass through a
bounded same-origin relay.

## Demo and live modes

Demo mode requires an empty collector list. It does not construct collectors,
resolve secret references, or initiate upstream requests. Six deterministic
states are derived from one bounded synthetic fixture at a fixed synthetic
time.

Live mode accepts zero collectors or any valid subset. Omitted collectors are
disabled rather than probed at a compiled default. The browser query override
for demo states is rejected in live mode.

## Public interfaces

The public configuration response contains only presentation settings needed
by the browser. It omits collector URLs, selectors, secret reference names, and
resolved secrets. Health responses expose liveness and aggregate readiness,
not credential state. The normalized dashboard response can contain operator
labels, coarse viewer locations, and viewer identities; access to that response
is therefore part of the operator's authorization boundary.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | Typed Node configuration and collector union |
| `src/secrets.ts` | Provider-neutral direct/`*_FILE` resolution |
| `src/collectors/` | Read-only upstream adapters and normalization |
| `src/cache/` | Scheduling, readiness, last-good, and stale state |
| `src/routes/` | Bounded same-origin HTTP routes |
| `public/` | Browser application and reviewed static assets |
| `fixtures/` and `src/demo.ts` | Synthetic demo source and state derivation |
| `energy/` | Optional energy sidecar and tests |
| `test/` | Contracts, collectors, security, and public-readiness tests |
