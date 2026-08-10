# Release process

Ravenhill is licensed under Apache License 2.0 but remains a pre-release
candidate. The presence of release automation does not make an artifact an
official release. The first public source commit, repository visibility,
registry publication, and stable-version declaration remain explicit
maintainer decisions.

## Release gates

A release candidate must pass all of the following from a clean checkout:

1. locked Node installation, high-severity dependency audit, type checking,
   tests, build, and browser-module syntax checks;
2. exact Python runtime dependency installation, dependency audit, sidecar
   tests, and bytecode compilation;
3. example configuration and synthetic demo validation;
4. dashboard and energy image builds with OCI source, revision, version, and
   Apache-2.0 labels;
5. hardened, network-isolated, healthy, restart-zero smoke tests for both
   images;
6. source, fixture, documentation, image filesystem, metadata, layer, SBOM,
   provenance, and build-log scanning;
7. responsive browser acceptance with no external demo requests, console
   errors, broken images, or horizontal overflow; and
8. an exact review of [asset provenance](ASSET-PROVENANCE.md) and
   [the naming decision](NAMING.md).

Scans suppress values. A match is classified and removed or documented; it is
never pasted into a public log to prove that a scanner found it. High or
critical dependency advisories block release unless a maintainer records a
narrow, evidence-backed disposition.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and calls
from the release workflow. Its uniquely named jobs are:

- `Node / quality`;
- `Python / quality`; and
- `Containers / build-and-smoke`.

Action references are pinned to full commit SHAs and Dependabot proposes
reviewed updates for npm, pip, Docker bases, and GitHub Actions.

After the clean root commit is pushed and the first CI run succeeds, protect
`main` with a GitHub ruleset that requires these three checks, requires pull
requests and review for non-maintainer changes, requires conversation
resolution, blocks force pushes and deletion, and allows only explicitly
documented maintainer bypass. Do not configure required checks before GitHub
has observed their exact names.

## Version and source identity

Releases use exact `vMAJOR.MINOR.PATCH` tags. Before creating a tag:

1. set `package.json` to the matching version;
2. move the relevant changelog entries to an exact `## [MAJOR.MINOR.PATCH]`
   heading;
3. require all default-branch checks to pass;
4. complete the final source and image scan; and
5. confirm the tag target is on `main`.

Release tags are immutable. Never move or recreate a published version tag.

## Container publication

`.github/workflows/release.yml` runs only for version tags in
`d4rk22/ravenhill`. It reruns the complete CI workflow and then verifies the
exact tag form, default-branch ancestry, package version, and changelog entry
before any registry login or push.

The workflow publishes two independently identified images:

- `ghcr.io/d4rk22/ravenhill-dashboard`; and
- `ghcr.io/d4rk22/ravenhill-energy`.

For the private `v0.1.0` release, each image receives the immutable version tag
and `sha-<full-commit>` tag, registry-native BuildKit SBOM and maximum-mode
provenance attestations, OCI identity labels, and a registry digest. GitHub
artifact attestations are deferred until Ravenhill is public or read-only
evidence proves eligibility through GitHub Enterprise Cloud. No floating
`latest` tag is produced. Deployments use the accepted digest, not a tag.

The dashboard and energy build contexts each carry the Apache license and
applicable notice into `/usr/share/licenses/ravenhill/` in the image.

## First-publication boundary

The release workflows are intentionally inert while this candidate remains a
subtree of the private homelab repository. Before the first Ravenhill release:

- create the clean root commit only from the reviewed candidate;
- run the final independent source, secret, container, SBOM, provenance,
  build-log, and layer inspection;
- enable private vulnerability reporting;
- run CI and apply the reviewed `main` ruleset;
- verify repository visibility separately; and
- publish only through the accepted tag workflow.

No source archive, container image, package, or registry digest should be
represented as official before those steps pass.
