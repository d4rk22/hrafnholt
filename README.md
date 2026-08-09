# Ravenhill

Ravenhill is a portable, read-only operations dashboard for a self-hosted
environment. A Node.js service validates configuration, polls only the
collectors an operator enables, normalizes their results, and serves a
same-origin browser application. An optional Python sidecar supplies energy
data. Ravenhill has no mutation API and demo mode needs no credentials or
upstream network.

This tree is a pre-release candidate licensed under Apache License 2.0. No
source archive, container image, or package should be represented as an
official Ravenhill release until it is produced by the guarded release
workflow from the reviewed public repository.

## Quick demo

Requirements: Node.js 24 and npm.

```bash
npm ci
npm run build
RAVENHILL_CONFIG=./ravenhill.example.yml npm start
```

Open <http://127.0.0.1:3000>. The example selects `healthy` demo mode and uses
only bounded synthetic data. The other review states are available at
`/?demo=empty`, `/?demo=stale`, `/?demo=degraded`,
`/?demo=collector-failure`, and `/?demo=privacy`.

## What Ravenhill provides

- strict, versioned YAML configuration with unknown-field rejection;
- optional, instance-driven collectors with independent timeout, freshness,
  failure, and last-good behavior;
- service-scoped secret references using direct variables for development and
  `*_FILE` inputs for production;
- a synthetic demo that constructs no collectors and reads no secret;
- same-origin health, configuration, dashboard, calendar, and bounded poster
  endpoints; and
- responsive privacy presentation, coarse map rendering, and accessible chart
  interactions.

Ravenhill does not provide authentication, authorization, secret storage, DNS,
TLS termination, or a deployment control plane. Operators must supply those
boundaries where their environment needs them.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Demo and live setup](docs/SETUP.md)
- [Typed configuration](CONFIGURATION.md)
- [Provider-neutral secret injection](docs/SECRETS.md)
- [Supported collectors](docs/COLLECTORS.md)
- [Privacy and security boundaries](docs/SECURITY.md)
- [Development](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Release readiness](docs/RELEASING.md)
- [Asset provenance](docs/ASSET-PROVENANCE.md)
- [Naming review](docs/NAMING.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## Health and API routes

| Route | Purpose |
| --- | --- |
| `GET /health/live` | Process liveness |
| `GET /health/ready` | Required-collector readiness |
| `GET /api/v1/configuration` | Bounded browser presentation settings |
| `GET /api/v1/dashboard` | Current normalized snapshot |
| `GET /api/v1/episodes?date=YYYY-MM-DD` | Bounded Sonarr calendar view |
| `GET /api/posters/radarr/:instance/:id` | Bounded Radarr poster relay |

The browser privacy mode is a presentation feature, not access control. Read
the [security boundary](docs/SECURITY.md) before exposing a live instance.

## License

Ravenhill is licensed under the [Apache License, Version 2.0](LICENSE). See
[`NOTICE`](NOTICE) for the project notice.
