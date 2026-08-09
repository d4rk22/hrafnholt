# Asset provenance and redistribution review

Review date: 2026-08-08.

This inventory covers every first-party visual shipped by the dashboard, the
geographic datasets from which its maps were derived, bundled font behavior,
runtime-relayed images, visual files found in the locked production npm
dependency tree, and upstream base-image visuals. It supplements the Apache
License 2.0 project license and records third-party provenance and decisions.

## Shipped application visuals

| Asset or rendered element | Source and derivation | License or rights basis | Redistribution and attribution | Decision |
| --- | --- | --- | --- | --- |
| `public/assets/storage-array.svg` (`00ac6c7c24bc17df88cd431f0cf275dc4c2b2f0b9c852b3e8dc0a43b3e10339a`) | Original SVG geometry authored in this repository on 2026-08-08; no external image, icon, or literary source | First-party project work under Apache License 2.0 | No third-party attribution; distributed under the repository `LICENSE` and `NOTICE` | Ship |
| `public/assets/world-map.svg` (`0650ecf4336a445c0e5b50489888ba6a23a90a4be65f052a8680ca493c8ccda2`) | Natural Earth 1:110m Admin 0 Countries v5.1.1, simplified and projected by `scripts/generate-world-map.mjs` into Ravenhill's `760 x 420` SVG view box | Natural Earth public domain | Permission and credit are not required; Ravenhill retains a courtesy source comment and this notice | Ship |
| Regional lower-48 plate and state lines in `public/index.html` | Natural Earth 1:110m Admin 0/Admin 1 geometry, simplified and projected into the regional map bounds. The historical transform did not retain the exact Natural Earth release number | Every Natural Earth vector release is public domain; the missing release number is a reproducibility weakness, not a rights gap | Permission and credit are not required; the inline source comment and this notice are retained. Regenerate from a pinned current release when the regional generator is next changed | Ship |
| Great Lakes layer in `public/index.html` | Natural Earth 1:50m Lakes polygons, simplified, projected, and clipped to the regional plate. The historical transform did not retain the exact Natural Earth release number | Every Natural Earth vector release is public domain | Same optional courtesy attribution as the other Natural Earth layers | Ship |
| Inline data-URI favicon in `public/index.html` | Original four-block dashboard glyph written directly as SVG path/rectangle geometry | First-party project work under Apache License 2.0 | No third-party attribution | Ship |
| Traffic, capacity, workload, route, node, and label SVG groups in `public/index.html` and `public/app.js` | Original chart scaffolds and runtime-generated geometry; they consume normalized numeric data and the reviewed map projections | First-party project work under Apache License 2.0, except the separately identified Natural Earth background geometry | No third-party attribution beyond the map notice | Ship |
| Brand grid, privacy indicator, status marks, panel decoration, gradients, and patterned backgrounds | Original HTML/CSS geometric composition; no icon library or external image source | First-party project work under Apache License 2.0 | No third-party attribution | Ship |

Natural Earth's [Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)
state that all versions of its raster and vector data are public domain and may
be modified and electronically distributed without permission or required
credit. The exact world source is the [1:110m Admin 0 Countries v5.1.1
dataset](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/).
The Great Lakes source belongs to the [1:50m Lakes + Reservoirs
dataset](https://www.naturalearthdata.com/downloads/50m-physical-vectors/).

The reviewed Admin 0 v5.1.1 ZIP has SHA-256
`0f243aeac8ac6cf26f0417285b0bd33ac47f1b5bdb719fd3e0df37d03ea37110`;
its `.shp` member has SHA-256
`08e341606e8391e458c3f08deb312de664b56bfae376064c5aa0aee6681a5f55`.
A clean regeneration with the dependency-free Node.js parser in
`scripts/generate-world-map.mjs` was byte-identical to the tracked
`world-map.svg`.

The Python energy sidecar ships no application image, SVG, map, font, icon, or
derived visual.

The final energy filesystem contains no visual file. Its
`python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0`
base layer carries 14 small CPython IDLE icons under
`/usr/local/lib/python3.13/idlelib/Icons/`; Ravenhill removes the unused IDLE
module and launchers in its dependency-install layer. The PSF-licensed icons
remain recoverable from the public upstream base layer, so the point-9 raw-
layer review inspected and classified all 14 as generic upstream assets with
no private or production-derived content.

## Fonts

Ravenhill ships no font file, web-font CSS, or font download. `public/styles.css`
uses only local system fallbacks:

- display: DIN Condensed, Arial Narrow, Avenir Next Condensed, or generic
  `sans-serif`;
- body: Avenir Next, Avenir, Segoe UI, or generic `sans-serif`; and
- mono: SFMono-Regular, Roboto Mono, Consolas, or generic `monospace`.

Those names request fonts already available to the user's browser and do not
redistribute the font programs.

## Runtime images that are not shipped

Radarr poster bytes are fetched only for a configured live collector and
relayed through a bounded same-origin route. They are not in Git, the demo
fixture, or the container filesystem. The operator is responsible for access
and display rights for their media artwork. A missing poster leaves the card's
first-party monogram fallback in place.

No screenshot is tracked. Demo browser evidence, reports, profiles, caches,
and incidental image output are ignored and excluded from the container build
context.

## Visual files removed from production dependencies

The locked npm tarballs and Node base image contain the following unused
documentation, example, test, or brand images. Their packages include license
files, but the images serve no Ravenhill runtime purpose; the `Dockerfile`
explicitly removes every path in the same layer as `npm ci` so none is present
in the final dashboard filesystem.

| Removed image path | SHA-256 | Upstream package |
| --- | --- | --- |
| `node_modules/@fastify/send/test/fixtures/images/node-js.png` | `6b2587c56b914750c30c69d51e1b192cc401e2d23777922983f8ff8092078d76` | `@fastify/send@4.1.0` |
| `node_modules/@fastify/static/example/public/images/sample.jpg` | `7c859e2f8ee6f21120d12a774038d0022dda0f44c37e4c7de34b07b7323b742c` | `@fastify/static@10.1.3` |
| `node_modules/@fastify/static/test/content-type/sample.jpg` | `7c859e2f8ee6f21120d12a774038d0022dda0f44c37e4c7de34b07b7323b742c` | `@fastify/static@10.1.3` |
| `node_modules/@fastify/static/test/static-pre-compressed/sample.jpg` | `7c859e2f8ee6f21120d12a774038d0022dda0f44c37e4c7de34b07b7323b742c` | `@fastify/static@10.1.3` |
| `node_modules/@fastify/static/test/static/shallow/sample.jpg` | `7c859e2f8ee6f21120d12a774038d0022dda0f44c37e4c7de34b07b7323b742c` | `@fastify/static@10.1.3` |
| `node_modules/fastify/docs/resources/encapsulation_context.svg` | `9f299f2791e82cfcbe0eadd0a6c35f328e7a0e0e8cec658fd4fce2bb285072f1` | `fastify@5.11.3` |
| `node_modules/pino/favicon.ico` | `c27c092d8b63286fcc2f3a75fee61da6f2bcdc9025d5e3bfd1df156f1fb1ded5` | `pino@10.3.1` |
| `/usr/local/lib/node_modules/npm/node_modules/qrcode-terminal/example/basic.png` | `7ebca694acacd1f9affc2c8f175506cb60b2fd014939a2127a19ac239b21d445` | `qrcode-terminal@0.12.0`, bundled by npm in `node:24-alpine` |

The package license sources are the upstream `LICENSE` files for
[Fastify 5.11.3](https://github.com/fastify/fastify/blob/v5.11.3/LICENSE),
[`@fastify/static` 10.1.3](https://github.com/fastify/fastify-static/tree/v10.1.3),
[`@fastify/send` 4.1.0](https://github.com/fastify/fastify-send/tree/v4.1.0),
and [Pino 10.3.1](https://github.com/pinojs/pino/tree/v10.3.1). Their software
licenses remain in the installed package tree even though these unused visual
files are removed. The bundled `qrcode-terminal` package is Apache License 2.0.
Ravenhill removes the complete unused npm, Corepack, and Yarn toolchains from
the final runtime filesystem after installing the application dependencies.

The QR sample is inherited in a lower `node:24-alpine` layer and whiteouted by
Ravenhill's cleanup layer. It is absent from the flattened dashboard
filesystem but remains recoverable when raw layers are inspected; point 9
classified it as the documented generic upstream Apache-2.0 example. The
other seven dependency visuals are installed and removed within one build
layer, so none appears in any final dashboard layer.

## Rejected legacy assets

| Removed path | Identity and derivation | Rights finding | Resolution |
| --- | --- | --- | --- |
| `public/assets/erebor-gate-original.png` | SHA-256 `176c22ca2c910ee9ccb34bd8a86ae3e033bc9d5114d775573b170ad6015e5271`; generated mountain/gate raster added with the original private dashboard | No prompt, generator, source material record, author grant, or redistribution record was retained | Removed; must not be copied into a public root or image |
| `public/assets/erebor-gate.svg` | SHA-256 `77312fde2ffb7ff81928d163177a879faadee45a97fbda6a1ab1f642727274cc`; Pixelmator Pro trace/rebuild of the preceding raster | The derivative cannot have a stronger redistribution chain than its undocumented source | Removed and replaced by the original neutral `storage-array.svg` |

The related name review is in [Naming](NAMING.md). Exact historical content
remains outside the public application candidate.

## Maintenance rule

Any new image, SVG, map, font, icon, screenshot, generated visual, or dependency
visual must update this inventory and its validation in the same change. If
source or redistribution rights cannot be established, remove or replace it
before release.
