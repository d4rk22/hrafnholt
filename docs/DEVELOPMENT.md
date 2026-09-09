# Development

## Toolchain

- Node.js `>=24 <25`
- npm with the committed lockfile
- Python 3.12 for the energy sidecar
- Docker for local image checks

Get the source first (requires Git):

```bash
git clone https://github.com/d4rk22/hrafnholt.git
cd hrafnholt
```

For a demo after installing the Node.js version above:

```bash
npm ci
npm run build
HRAFNHOLT_CONFIG=./hrafnholt.example.yml npm start
```

Open <http://localhost:3000>. The environment-variable syntax above is for
Mac/Linux shells. In PowerShell, set it before starting:

```powershell
$env:HRAFNHOLT_CONFIG = "./hrafnholt.example.yml"
npm start
```

The example constructs no live collector and uses only synthetic data. Other
review states include `/?demo=empty`, `/?demo=stale`, `/?demo=degraded`,
`/?demo=collector-failure`, and `/?demo=privacy`.

### Capture the showcase

The full screenshot uses `examples/showcase.yml`, which selects `showcase`,
four fictional viewers, a fictional home marker, and no collectors. From a
source checkout containing the showcase change, after building, run:

```bash
HRAFNHOLT_CONFIG=./examples/showcase.yml npm start
```

In PowerShell, use `$env:HRAFNHOLT_CONFIG = "./examples/showcase.yml"` followed
by `npm start`. Stop any other local dashboard using port 3000 first.
The v0.1.15 images in the installation guide predate this optional scenario;
their ordinary healthy demo still works as documented.

Open <http://localhost:3000>, select **1W** in Capacity headroom, and use a
1600-pixel-wide desktop viewport. Enable reduced motion, wait for all panels
to finish rendering, and scroll through the media shelf so all 16 lazy-loaded
posters appear before taking a full-page screenshot. The screenshot's clock
is fixed at January 15, 2030. A 390-pixel viewport is used for phone QA.

Only the app's rendered pixels are captured; no production response, browser
storage, photograph, poster download, or production screenshot is an input.
Verify the **SYNTHETIC DEMO · SHOWCASE** banner, zero external browser requests,
no console errors, loaded images, and no horizontal page overflow before
publishing. Record the final image hashes in the asset provenance inventory.

The poster SVGs are original geometric artwork. Regenerate them with
`node scripts/generate-demo-posters.mjs`; it requires no network or credentials.
The existing `/?demo=showcase` selector also works in a demo runtime, using
that runtime's presentation settings.

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
