# Hrafnholt configuration

Hrafnholt reads versioned, non-secret settings from `hrafnholt.yml`. Set
`HRAFNHOLT_CONFIG` to choose another path. The dashboard and energy sidecar
validate their required sections before listening; malformed configuration,
unknown fields, and missing secrets stop startup with value-suppressed errors.

Use `hrafnholt.example.yml` as the public-safe starting point. It selects demo
mode, neutral UTC presentation defaults, no home coordinates, public privacy
presentation, and zero collectors. `.env.example` contains only synthetic
local-development values. Copy it to the ignored `.env` path before
`npm start`; the Node 24 start script loads that file when present and does not
require it in containers or other production environments.

## Modes and collector instances

Configuration presence enables a collector. There is no compiled endpoint,
device identifier, channel, credential name, or private location fallback.
`demo` mode requires `collectors: []`, while `live` mode accepts an empty list
or any valid subset. Demo mode never constructs a collector, resolves a
credential, or calls a private endpoint. It loads one bounded synthetic base
fixture and deterministically selects one of six review states:

- `healthy`: every normalized panel is current;
- `empty`: every panel has an explicit no-data envelope;
- `stale`: bounded last-good data is retained beyond its freshness window;
- `degraded`: partial storage, protection, energy, and service-posture data
  remain independently usable;
- `collector-failure`: the synthetic download collector fails without erasing
  healthy panels; and
- `privacy`: three synthetic viewer identities exercise public masking and the
  optional private presentation toggle.

Set `demo.state` in `hrafnholt.yml`. Demo snapshots and the browser clock use
the fixed, obviously synthetic timestamp in the fixture, so screenshots do not
capture an operator's local or production clock. The image's built-in example
configuration selects `healthy`, allowing the dashboard container to start in
demo mode without a mounted configuration or any environment variable. While
the server is in demo mode, `/?demo=stale` (or another listed state) selects a
state for that browser session; invalid selectors fail with HTTP `400`, and
the override is rejected entirely in live mode.

Every collector has an operator-selected `id` and `name`. Sonarr, Radarr,
SABnzbd, and qBittorrent may appear any number of times, so names such as
`Television`, `Animation`, `Movies`, or `Archive downloads` replace fixed
normal/4K slots. Sources that currently map to a singular dashboard panel are
limited to one named instance and fail validation if duplicated.

All collector types support:

- `required`, which controls readiness after the collector is explicitly
  configured;
- `poll_interval_seconds`, `timeout_seconds`, and `stale_after_seconds`;
- `panel.title`, an optional presentation label.

HTTP collectors also support `tls_verify`, which defaults to `true`. Set it to
`false` only for an explicitly reviewed endpoint whose certificate cannot be
validated normally. Collector URLs are base URLs and reject embedded
credentials, query strings, and fragments; secrets belong only in typed
reference fields.

Type-specific settings are encoded as a strict discriminated union. URLs,
status-page slugs, Proxmox storage selectors, UniFi site/PDU selectors,
persistent-state paths, and secret-reference fields are accepted only where
the corresponding collector type defines them. Arbitrary shell, command, and
template fields are rejected.

The type-specific required fields are:

| Type | Required fields | Repeatable |
| --- | --- | --- |
| `tracearr` | `url`, `token_ref`; an explicit presentation home | No |
| `unifi` | `url`, `username_ref`, `password_ref`; optional `site` and `pdu` selector/state path | No |
| `netdata` | `url`, all typed `metrics` chart/dimension selectors; optional GPU label, workload chart/start, and `proxmox_node` association | No |
| `energy` | sidecar `url`; the top-level `energy` section | No |
| `ups` | `host`, `username_ref`, `auth_password_ref`, `privacy_password_ref` | No |
| `sabnzbd` | `url`, `api_key_ref` | Yes |
| `qbittorrent` | `url`, `username_ref`, `password_ref` | Yes |
| `sonarr` | `url`, `api_key_ref` | Yes |
| `radarr` | `url`, `api_key_ref` | Yes |
| `arcane` | `url`, `api_key_ref` | No |
| `proxmox` | `url`, `api_token_ref`, `storage_id`; optional `exclude_nodes` and `node_roles` | No |
| `truenas` | `url`, `api_key_ref` | No |
| `backups` | `pve.url`, `pve.api_token_ref`; optional PBS URL/token reference | No |
| `uptime_kuma` | `url`, `status_page_slug` | No |

Every row also requires the common `type`, `id`, and `name` fields. An omitted
row is disabled; it does not cause Hrafnholt to probe a default endpoint.

Netdata chart IDs are deployment-specific and therefore have no compiled
fallback. Its `metrics` mapping requires selectors for GPU utilization,
encoder/decoder utilization, used/free VRAM, temperature, power, CPU, and the
used/free/cached/buffered RAM dimensions. `gpu.name` and `gpu.tensor_cores`
control hardware presentation. The optional `workload.chart` and
`workload.start_at` fields enable retained stream/transcode context, while
`proxmox_node` selects the configured node whose CPU model is shown beside the
Netdata host. The dashboard never guesses any of these values from a private
host name or device model.

```yaml
- type: netdata
  id: telemetry
  name: Media telemetry
  url: https://telemetry.example
  gpu: {name: Example GPU, tensor_cores: 96}
  proxmox_node: compute-a
  metrics:
    gpu_utilization: {chart: gpu.utilization, dimension: utilization}
    encoder_utilization: {chart: gpu.codec, dimension: encoder}
    decoder_utilization: {chart: gpu.codec, dimension: decoder}
    vram_used: {chart: gpu.memory, dimension: used}
    vram_free: {chart: gpu.memory, dimension: free}
    temperature: {chart: gpu.temperature, dimension: temperature}
    power: {chart: gpu.power, dimension: watts}
    cpu: {chart: system.cpu, dimension: __total__}
    ram_used: {chart: system.ram, dimension: used}
    ram_free: {chart: system.ram, dimension: free}
    ram_cached: {chart: system.ram, dimension: cached}
    ram_buffers: {chart: system.ram, dimension: buffers}
  workload:
    chart: media.workload
    start_at: 2030-01-01T00:00:00Z
```

## Secrets

A typed secret field contains an environment-variable name, never a secret
value. For a field such as `api_key_ref: MEDIA_API_KEY`, Hrafnholt supports:

```text
MEDIA_API_KEY_FILE=/run/secrets/media_api_key
MEDIA_API_KEY=synthetic-local-value
```

`*_FILE` is the production interface. The direct variable is a compatibility
and local-development fallback. Setting both forms fails startup; Hrafnholt
does not choose one silently. Secret files are read once, one trailing line
ending is removed, and errors identify only the reference and interface—not
the value or resolved file path.

The dashboard resolves only secrets used by dashboard collectors. The energy
sidecar reads its `energy` section plus the presentation timezone and resolves
only its provider credentials, preserving service-scoped injection. Neither service
returns secret references or values from the public configuration endpoint,
health endpoints, normalized snapshot, or error payloads.

## Presentation and location

`presentation` configures title, subtitle, home label, locale, IANA timezone,
temperature units, optional home coordinates/country code, and privacy behavior. Without a home
location the browser hides the home marker and route lines. A Tracearr live
collector requires an explicit home location because local-network sentinel
mapping otherwise has no safe geographic meaning.

The safe privacy default is `public` with `allow_private_toggle: false`.
Enabling the browser toggle is a presentation convenience only: browser-side
masking is not an authorization boundary, because a client with API access can
inspect normalized responses. Do not expose Hrafnholt to untrusted users when
the API contains identities or locations they are not authorized to see.

`privacy.aliases` optionally replaces the built-in Argonaut roster used for
masked viewer names: 2 to 64 unique entries (case-insensitive), each 1 to 40
characters after trimming. An empty or omitted list keeps the built-in roster.
Aliases are shuffled per browser session and assigned stably to each distinct
viewer within that session; a roster smaller than the number of concurrent
viewers reuses names in assignment order.

## Energy configuration

The optional `energy` section configures the provider, service-scoped secret
references, device and channel selectors, currency, tax/fixed charges, cache
TTL, and seasonal per-kWh rates. The schema requires every calendar month to
appear exactly once across the named rate seasons. Rate selection uses the
configured presentation timezone. The sidecar has no compiled
device/channel/rate fallback.
