# Development

## Toolchain

- Node.js `>=24 <25`
- npm with the committed lockfile
- Python 3.12 for the energy sidecar
- Docker for local image checks

Install and run the normal validation suite from this directory:

```bash
npm ci
npm run check
python3 -m unittest discover -s energy -p 'test_*.py'
python3 -m py_compile energy/app.py energy/test_energy.py
python3 -m pip install --no-cache-dir pip-audit==2.10.1
python3 -m pip_audit --requirement energy/requirements.txt
```

Tests use synthetic configuration, fixtures, usernames, locations, services,
and timestamps. Do not copy a production response into a fixture or failure
message.

## Working locally

Use `hrafnholt.example.yml` for demo mode. `.env.example` contains synthetic
development values and may be copied to ignored `.env` when testing direct
secret variables. Prefer temporary files when testing the `*_FILE` interface;
never add their contents to logs or assertions.

The server source compiles into ignored `dist/`. Browser modules under
`public/` are intentionally dependency-free and are syntax-checked directly.
Application source maps are disabled for the release candidate.

## Adding or changing a collector

1. Add or revise its strict branch in the discriminated union in
   `src/config.ts`.
2. Keep endpoint, selector, and secret-reference fields explicit; add no
   deployment-specific default.
3. Resolve credentials through `src/secrets.ts`, never directly from an
   arbitrary environment name.
4. Normalize and bound upstream data before it reaches the snapshot contract.
5. Give the collector an independent timeout and preserve failure isolation.
6. Add configuration, normalizer, failure, server, and private-marker tests.
7. Update [the collector matrix](COLLECTORS.md) and configuration docs.

Collector tests should use in-memory fetch doubles. They must not contact a
developer's local services merely because an environment variable is present.

## Browser and privacy changes

Treat the API response as the security boundary. A visual mask does not redact
the response. Test desktop and narrow-phone layout, keyboard behavior, reduced
motion, console errors, external requests, and horizontal overflow for every
new state.

Public screenshots must come from demo mode, be reviewed at full resolution,
and remain outside Git unless explicitly approved as release assets.

## Static assets

Every image, SVG, geographic map, font, icon, or derived visual must be entered
in [the provenance inventory](ASSET-PROVENANCE.md) before it can ship. The
entry must identify its source, derivation, license or rights basis,
redistribution status, and attribution. Unknown provenance means removal or
replacement, not an `unknown` release entry.

The world map can be regenerated from the pinned Natural Earth Admin 0 source
shapefile with the dependency-free Node.js generator:

```bash
node scripts/generate-world-map.mjs \
  /path/to/ne_110m_admin_0_countries.shp \
  public/assets/world-map.svg
```

The source dataset is not vendored. Preserve its release name and checksum in
the provenance review when regenerating the output.

## Documentation

Public application documentation belongs in this tree and must remain generic.
Operator-specific endpoints, deployment identities, proxy and DNS state,
rollback commands, secret-manager wiring, and migration evidence belong in the
operator's private infrastructure repository.

## Dependency updates

Node and Python dependency advisories are release-blocking at high or critical
severity unless a maintainer records a narrow, evidence-backed disposition.
Use the committed npm lockfile, keep Python runtime requirements exact, and let
Dependabot propose npm, pip, container-base, and GitHub Actions updates. Action
references remain pinned to full commit SHAs and are updated only through
reviewed pull requests.
