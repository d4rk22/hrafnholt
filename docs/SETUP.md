# Demo and live setup

## Prerequisites

- Node.js `>=24 <25` and npm for the dashboard;
- Python 3.12 only when using the energy sidecar; and
- Docker or another OCI runtime only when building the local containers.

The examples use synthetic hostnames and secret names. Do not put real values
in source control.

## Run the synthetic demo

```bash
npm ci
npm run build
RAVENHILL_CONFIG=./ravenhill.example.yml npm start
```

Browse to <http://127.0.0.1:3000> and verify:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

The demo configuration contains no live collector. Query selectors such as
`/?demo=stale` are available only in this mode.

## Build and run the dashboard container locally

```bash
docker build --tag ravenhill-dashboard:local .
docker run --rm \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --publish 127.0.0.1:3000:3000 \
  ravenhill-dashboard:local
```

The image contains the synthetic example configuration, so this command starts
demo mode. A strict network-isolation smoke test may use `--network=none`; it
will need an in-container health probe rather than a published host port.

## Prepare live configuration

Copy the example outside the source tree, set `mode: live`, remove the example
`energy` section unless it is used, and add only the collectors needed by the
deployment. For example:

```yaml
schema_version: 1
mode: live

server:
  host: 0.0.0.0
  port: 3000
  log_level: info

presentation:
  branding:
    title: Ravenhill
    subtitle: Operations dashboard
    home_label: Home
  locale: en-US
  timezone: UTC
  home: null
  privacy:
    default_mode: public
    allow_private_toggle: false
  units:
    temperature: celsius

collectors:
  - type: sonarr
    id: television
    name: Television
    url: https://sonarr.example
    api_key_ref: TELEVISION_API_KEY
    poll_interval_seconds: 60
    timeout_seconds: 5
    stale_after_seconds: 300
    tls_verify: true
```

Create the referenced secret outside source control. A container example is:

```bash
docker run --rm \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --publish 127.0.0.1:3000:3000 \
  --mount type=bind,src=/etc/ravenhill/ravenhill.yml,dst=/etc/ravenhill/ravenhill.yml,readonly \
  --mount type=bind,src=/run/operator-secrets/television-api-key,dst=/run/secrets/television-api-key,readonly \
  --env TELEVISION_API_KEY_FILE=/run/secrets/television-api-key \
  ravenhill-dashboard:local
```

Use an absolute source path and protect host secret files with the least
privileges supported by the platform. The application process needs read
access, but the file must not be world-readable.

## Optional energy sidecar

The sidecar requires the top-level `energy` configuration and its two secret
references. Build it separately:

```bash
docker build --tag ravenhill-energy:local ./energy
```

Mount the same read-only configuration into both services, inject only the
energy secret files into the sidecar, and configure the dashboard's `energy`
collector with the sidecar's internal HTTP URL. Do not publish port 8080 unless
an operator has a specific protected use for it.

## Exposure checklist

Before allowing users beyond the local machine:

1. keep `tls_verify: true` unless a reviewed exception is unavoidable;
2. put the dashboard behind TLS and authentication appropriate to the data;
3. limit upstream credentials to read-only permissions;
4. decide whether normalized identities and coarse locations may be returned;
5. verify both health routes and every configured panel; and
6. review the [privacy and security boundary](SECURITY.md).
