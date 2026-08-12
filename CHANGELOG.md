# Changelog

All notable Ravenhill changes will be recorded here. The project follows
[Semantic Versioning](https://semver.org/) after its first public release.

## Unreleased

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
