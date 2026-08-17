# Contributing to Hrafnholt

Thank you for helping improve Hrafnholt. Contributions should preserve its
portable, read-only, privacy-conscious operating boundary.

## Before opening an issue

- Search existing issues and documentation.
- Use synthetic examples. Never attach credentials, private endpoints, raw
  production responses, personal screenshots, or identifiable operational
  data.
- Report security vulnerabilities through the private process in
  [`SECURITY.md`](SECURITY.md), not a public issue.
- Discuss substantial features before investing in a large implementation.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install Node.js 24, Python 3.12, and Docker when container changes are in
   scope.
3. Run the checks documented in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
4. Add directly responsible tests and update affected documentation.
5. Open a pull request using the repository template.

Pull requests must keep configuration strict and provider-neutral, construct no
collector in demo mode, preserve value-suppressed errors, and avoid adding a
mutation API. New assets require a complete entry in
[`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md). Naming changes must
follow [`docs/NAMING.md`](docs/NAMING.md).

## Commit and pull-request scope

Keep commits reviewable and do not mix unrelated formatting or dependency
changes. A pull request is ready when:

- `npm run check` passes;
- the Python tests, compilation, and dependency audit pass;
- both container images build when their inputs changed;
- demo mode makes no external request;
- documentation and examples remain synthetic; and
- no generated report, browser profile, local secret file, or screenshot is
  committed accidentally.

## Licensing contributions

Hrafnholt is licensed under Apache License 2.0. Unless you explicitly state
otherwise, a contribution intentionally submitted for inclusion in Hrafnholt
is provided under the same license, as described by section 5 of
[`LICENSE`](LICENSE). Do not submit code, data, documentation, or artwork that
you do not have the right to contribute.

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
