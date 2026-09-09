# Changelog

All notable Hrafnholt changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) after its first public release.

## Unreleased

### Added

- Add a credential-free `showcase` demo with dense synthetic history, fictional
  media and original poster art, consistent energy totals, and a full-page
  documentation screenshot.

### Fixed

- Preserve the selected demo scenario when navigating the episode calendar.
- Associate demo CPU telemetry with its synthetic compute node.

### Documentation

- Add a demo screenshot, Docker-first quick start, and guided Compose examples
  for sample data, Uptime Kuma, Sonarr, and optional Emporia energy.
- Clarify startup checks, secret-file permissions, network access, and updates.

## [0.1.15] - 2026-09-07

### Changed

- Label Internet telemetry with its UniFi Network source and show purple upload
  above the baseline with teal download below.
- Use teal Rack draw bars and purple estimated costs in both energy ledgers.
- Use purple for running verification and garbage collection states while
  preserving amber warnings.

## [0.1.14] - 2026-09-06

### Changed

- Match service-health DOWN counts, bar segments, and attention text to the
  dashboard’s existing amber REVIEW color.

## [0.1.13] - 2026-09-06

### Changed

- Replace the decorative service-posture dots with balanced up/down counts and
  a proportional service-health bar. Pending, maintenance, and unknown monitors
  occupy a neutral share; stale or unavailable data cannot appear healthy.

## [0.1.12] - 2026-09-06

### Fixed

- Map labels stay close to crowded city markers, clear surrounding home
  halos, and use nearby diagonal positions before distant rows. Placement
  remains stable when streams change order, with subtle connectors for
  displaced labels that avoid other markers and labels.
- Update Fastify and its URI parsing dependencies to clear dependency
  security advisories before release.

## [0.1.11] - 2026-08-29

### Changed

- The energy pane's Top energy consumers list gains share and estimated
  30-day cost columns: each circuit shows its share of the house's
  consumption today and that share applied to the projected 30-day house
  cost, with a footer disclosing the projection basis and rate. The list
  shows six circuits instead of seven so the panel keeps its height.
- The rack panel's per-outlet load bars drop their empty track,
  showing only the filled portion.

## [0.1.10] - 2026-08-29

### Added

- The capacity overhead pane gains a time-window selector with
  range-aware capacity histories (per-window coverage, singular units).

### Changed

- The energy pane's "Top circuit movers" list is replaced by "Top energy
  consumers": the top seven circuits by energy consumed since local
  midnight, read from the provider's day-scale usage. The energy payload
  key `movers` (and its `window_minutes`) is replaced by
  `top_consumers`; the in-memory sampling history is gone, so the list
  is accurate immediately after a restart.

## [0.1.9] - 2026-08-24

### Added

- Release images now carry GitHub artifact attestations: the publish job
  signs build provenance for each image's index digest with the
  workflow's OIDC identity and pushes it to the registry, so any consumer
  can verify origin with `gh attestation verify`. Earlier releases
  predate attestations and remain unattested.

## [0.1.8] - 2026-08-18

### Changed

- Container images are now public on GHCR. The release workflow's final job
  inverts from requiring anonymous registry access to be denied to requiring
  an anonymous end-to-end pull of the released tag to succeed, and the setup
  guide documents digest-pinned deployment of the published images.

## [0.1.7] - 2026-08-17

### Changed

- The project is renamed from Ravenhill to Hrafnholt (Old Norse: raven wood/hill) by maintainer decision recorded in docs/NAMING.md. Every occurrence moves in one pass: package name, branding default, container image names (ghcr.io/d4rk22/hrafnholt-dashboard and -energy from the next release), the HRAFNHOLT_CONFIG environment variable, the hrafnholt.example.yml configuration file, and all documentation. This is a pre-first-public-release breaking rename with no compatibility aliases.

## [0.1.6] - 2026-08-17

### Added

- `presentation.privacy.aliases` lets operators configure the roster used
  for masked viewer names: 2-64 unique entries, each at most 40 characters,
  validated server-side and sanitized again in the browser. An empty or
  omitted list keeps the built-in roster.

### Changed

- The built-in privacy alias roster is now the crew of the Argo (Acastus
  through Zetes, from the public-domain ancient Greek sources), replacing
  the botanical list.

## [0.1.5] - 2026-08-17

### Added

- The energy panel lists the top five circuit movers: the energy sidecar
  now samples every real circuit each poll (aggregate selectors and the
  provider's pseudo-channels excluded), keeps a one-hour in-memory
  window, and reports the largest signed watt changes; the dashboard
  renders them with rising draw in amber and falling draw in teal. The
  list warms up over the first hour after a sidecar restart and hides
  until it has at least one nonzero change.

## [0.1.4] - 2026-08-17

### Changed

- Give the storage panel a second-generation mountain-gate icon: every
  path newly authored in this repository, with the motif following the
  project's own earlier first-party art. The asset inventory, provenance
  ledger, and public-readiness scans cover the new file; the previous
  storage-array illustration remains shipped.

## [0.1.3] - 2026-08-16

### Fixed

- Close the UPS SNMP session only once. Aborting an in-flight request made
  net-snmp cancel pending requests from inside the socket close handler, and
  the second close threw `ERR_SOCKET_DGRAM_NOT_RUNNING` outside the collect
  promise, exiting the dashboard process.

## [0.1.2] - 2026-08-12

### Added

- Report only an allowlisted, fixed energy collection failure stage with HTTP
  503 responses while preserving the successful response contract and the
  existing bounded provider-call sequence.

## [0.1.1] - 2026-08-10

### Fixed

- Use the authenticated-user GitHub Packages REST endpoint when verifying
  private user-scoped release packages.

## [0.1.0] - 2026-08-09

### Added

- Apache License 2.0 licensing and project notice.
- Contribution, security, conduct, issue, and pull-request policies.
- Required Node, Python, dependency, and hardened container CI checks.
- Guarded tag-only workflows for separately identifiable dashboard and energy
  images with OCI metadata, SBOMs, provenance, immutable tags, and digests.

### Changed

- Updated direct and transitive Node dependencies to clear the release
  candidate's high-severity audit findings.
