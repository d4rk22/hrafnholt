# Public website and static demo

The project website is <https://hrafnholt.com/>. Its interactive showcase lives
at <https://hrafnholt.com/demo/>. Both are static files hosted by GitHub Pages.
No dashboard server, collector, credential, database, or homelab connection is
used by the public site.

## Build and preview

Use Node.js 24 and the committed dependency lockfile:

```bash
npm ci
npm run build:site
python3 -m http.server 8080 --bind 127.0.0.1 --directory .site-dist
```

Open <http://localhost:8080/> and <http://localhost:8080/demo/>. Stop the preview
with Ctrl+C. `.site-dist/` is generated and ignored; do not edit it directly.

`site/` supplies the landing page and demo navigation. The build copies the
actual dashboard UI from `public/` and marks its HTML as a static demo. The
shared data adapter then loads `demo/data.json` once, keeps calendar navigation
in the browser, and skips server polling. All seven demo scenarios remain
available through `?demo=showcase`, `?demo=empty`, and the other documented
selectors. Invalid selectors display a data error. Normal dashboard deployments
continue using their server APIs.

The exporter uses only the checked-in showcase configuration and synthetic
fixture/generator. It validates snapshots against the application contract and
never loads an operator's configuration or credentials. Demo media paths stay
under `/demo/assets/`. No service worker or API emulation is needed.

## Publishing

Changes follow the repository's normal PR process and required checks. The
`Deploy public site` workflow builds and publishes from `main` using pinned
GitHub Actions. It uploads only `.site-dist/`; source, dependencies, operator
files, and incidental output are not publication inputs. The `github-pages`
environment limits deployment to `main`. Site deployment does not publish a
container release or change a live self-hosted dashboard.

After deployment, check the landing page, `/demo/`, all four chart windows,
calendar navigation, poster loading, phone layout, and `/build.json` (commit
and application version). Browser requests should remain on the site origin
and should never call `/api/`. Clicking documentation links intentionally opens
GitHub. A missing path should return the custom 404 page.

Domain/DNS state and operational rollback notes belong in the private
infrastructure repository. To roll back site content, revert the website PR
through the normal PR process or rerun a previously successful site workflow
for the desired commit.
