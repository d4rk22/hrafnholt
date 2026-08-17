# Changelog

All notable Hrafnholt changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) after its first public release.

## Unreleased  ### Changed  - The project is renamed from Ravenhill to Hrafnholt (Old Norse: raven wood/hill) by maintainer decision recorded in docs/NAMING.md. Every occurrence moves in one pass: package name, branding default, container image names (ghcr.io/d4rk22/hrafnholt-dashboard and -energy from the next release), the HRAFNHOLT_CONFIG environment variable, the hrafnholt.example.yml configuration file, and all documentation. This is a pre-first-public-release breaking rename with no compatibility aliases.

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
