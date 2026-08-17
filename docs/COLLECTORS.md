# Supported collectors

A collector exists only when its row appears in `collectors`. Hrafnholt has no
compiled endpoint, credential, host, device, or location fallback. Every row
requires a unique `id`, an operator-facing `name`, and its type-specific
settings.

## Collector matrix

| Type | Dashboard responsibility | Required type-specific fields | Secret references | Repeatable |
| --- | --- | --- | --- | --- |
| `tracearr` | Current Plex stream activity and coarse locations | `url`; an explicit presentation home in live mode | `token_ref` | No |
| `unifi` | WAN traffic and optional metered PDU state | `url`; optional `site`, `pdu.mac_address`, and `pdu.state_path` | `username_ref`, `password_ref` | No |
| `netdata` | Host, GPU, capacity, and optional workload history | `url`, all typed `metrics`; optional `gpu`, `workload`, and `proxmox_node` | None | No |
| `energy` | Data from the optional Hrafnholt energy sidecar | `url`; matching top-level `energy` section | None in dashboard service | No |
| `ups` | APC-compatible SNMPv3 UPS telemetry | `host` | `username_ref`, `auth_password_ref`, `privacy_password_ref` | No |
| `sabnzbd` | Download queue state | `url` | `api_key_ref` | Yes |
| `qbittorrent` | Torrent queue state | `url` | `username_ref`, `password_ref` | Yes |
| `sonarr` | Episode calendar and media pipeline state | `url` | `api_key_ref` | Yes |
| `radarr` | Movie state and bounded poster relay | `url` | `api_key_ref` | Yes |
| `arcane` | Read-only container environment summary | `url` | `api_key_ref` | No |
| `proxmox` | Cluster resources and selected storage | `url`, `storage_id`; optional `exclude_nodes`, `node_roles` | `api_token_ref` | No |
| `truenas` | System identity and aggregate storage capacity | `url` | `api_key_ref` | No |
| `backups` | PVE task history and optional PBS protection state | `pve.url`; optional `pbs.url` | `pve.api_token_ref`; optional `pbs.api_token_ref` | No |
| `uptime_kuma` | Public status-page posture | `url`, `status_page_slug` | None | No |

Sonarr, Radarr, SABnzbd, and qBittorrent accept arbitrary named instances. The
remaining types currently map to singular dashboard panels and reject a second
row of the same type.

## Common controls

All collectors accept:

| Field | Default | Meaning |
| --- | --- | --- |
| `required` | `true` | Whether readiness waits for its first attempt |
| `poll_interval_seconds` | `30` | Normal collection interval |
| `timeout_seconds` | `5` | Per-attempt deadline |
| `stale_after_seconds` | `120` | Age at which last-good data becomes stale |
| `panel.title` | unset | Optional presentation title |

HTTP collectors also accept `tls_verify`, defaulting to `true`. Base URLs must
use HTTP or HTTPS and cannot contain credentials, a query, or a fragment.
`stale_after_seconds` must be at least the poll interval.

## Failure and readiness behavior

Collectors are isolated. A timeout or upstream error updates that panel's
envelope without failing unrelated panels. Last-good data may remain available
until it is stale. An omitted collector is `disabled`, not an error.

`required: false` prevents a configured collector from blocking readiness, but
does not hide its failures. It is not a substitute for removing a collector
that should make no network request.

## Upstream permissions

Use a read-only account or token whenever the upstream supports one. Hrafnholt
does not intentionally call mutation routes, but upstream authorization is the
stronger boundary if a collector or dependency is ever defective. Keep each
credential limited to the specific service and API scope it needs.

## Derived panels

Some browser views combine normalized data without adding another upstream:
watchlist state derives from existing media data, energy cost combines current
measurements with configured rates, and capacity context may associate a
Netdata host with a configured Proxmox node. These are presentation or
normalization steps, not hidden collectors.

See [typed configuration](../CONFIGURATION.md) for field constraints and the
example schema.
