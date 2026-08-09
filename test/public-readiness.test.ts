import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "yaml";

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const candidateRoots = [".github", "src", "public", "fixtures", "test", "energy", "docs", "scripts"];
const runtimeEntryFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONFIGURATION.md",
  "CONTRIBUTING.md",
  "Dockerfile",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "package.json",
  "package-lock.json",
  "ravenhill.example.yml",
  "tsconfig.json",
  "energy/Dockerfile",
  "energy/app.py",
  "energy/requirements.txt",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".py", ".svg", ".ts", ".txt", ".yaml", ".yml"]);
const privateMarkers = [
  /(?:[a-z0-9-]+\.)?d4rk\.co/i,
  /\b10\.(?:\d{1,3}\.){2}\d{1,3}\b/,
  /\b192\.168\.(?:\d{1,3}\.)\d{1,3}\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}\b/,
  /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i,
  /\b229132\b/,
  /\b40\.8\b/,
  /-96\.7\b/,
  /\b(?:dell-r640-pve|smgold-pve|witness-pve)\b/i,
  /\bzfs-ssd\b/i,
  /nvidia_smi_plex_a2000/i,
  /NVIDIA RTX A2000/i,
  /TrueNAS\s*(?:→|->)\s*Unraid|truenas-unraid|future media backup/i,
  /2026-07-15T05:30:00\.000Z/,
  /America\/Chicago/,
  /Lincoln\s*[·,]/i,
  /"user"\s*:\s*"ryan"/i,
  /d4rk-dashboard|dashboard-energy/i,
  /\b(?:G9-pbs|truenas-erebor|the-hoard|pbs-archive)\b/i,
  /\b(?:matt|Mellowknee|PowerPonyPatrol|jptiger10|sethflemmer)\b/i,
  /\b(?:The Bear|Severance|Taskmaster|Criminal Minds|Indiana Jones and the Last Crusade)\b/i,
  /\b(?:Omaha|Providence|Apex|Grand Island|Kansas City)\b/i,
  /2026-07-(?:10|12|15|20|22)T/,
];

async function collectRuntimeFiles(relativeRoot: string): Promise<string[]> {
  const root = join(dashboardRoot, relativeRoot);
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(join(relativeRoot, entry.name));
    return textExtensions.has(extname(entry.name)) ? [path] : [];
  }))).flat();
}

function suppressClassifiedScannerRules(path: string, content: string): string {
  return relative(dashboardRoot, path) === "test/public-readiness.test.ts"
    ? content.replace(/const privateMarkers = \[[\s\S]*?\n\];/, "const privateMarkers = [CLASSIFIED_SCANNER_RULES];")
    : content;
}

test("candidate source, fixtures, tests, and text artifacts contain none of the reviewed private markers", async () => {
  const files = [
    ...(await Promise.all(candidateRoots.map(collectRuntimeFiles))).flat(),
    ...runtimeEntryFiles.map((path) => join(dashboardRoot, path)),
  ];
  const matches: string[] = [];
  for (const path of files) {
    const content = suppressClassifiedScannerRules(path, await readFile(path, "utf8"));
    for (const marker of privateMarkers) {
      if (marker.test(content)) matches.push(`${relative(dashboardRoot, path)}: ${marker.source}`);
      marker.lastIndex = 0;
    }
  }
  assert.deepEqual(matches, []);
});

test("standalone repository ignore policy excludes local dependencies, secrets, builds, and incidental output", async () => {
  const ignore = await readFile(join(dashboardRoot, ".gitignore"), "utf8");
  for (const pattern of [
    ".DS_Store",
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules/",
    "dist/",
    "__pycache__/",
    "*.py[cod]",
    ".venv/",
    ".pytest_cache/",
    ".playwright-cli/",
    "**/output/playwright/",
    "**/playwright-report/",
    "**/test-results/",
    "**/blob-report/",
    "**/.browser-profile/",
    "**/.cache/ms-playwright/",
    "fixtures/sources/",
    "*.log",
  ]) {
    assert.match(ignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("container build excludes macOS metadata and application source maps", async () => {
  const dockerIgnore = await readFile(join(dashboardRoot, ".dockerignore"), "utf8");
  for (const pattern of [
    "**/.DS_Store",
    ".playwright-cli",
    "output/playwright",
    "playwright-report",
    "test-results",
    "blob-report",
    ".browser-profile",
    ".cache/ms-playwright",
  ]) {
    assert.match(dockerIgnore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }

  const tsconfig = JSON.parse(await readFile(join(dashboardRoot, "tsconfig.json"), "utf8")) as {
    compilerOptions?: { sourceMap?: boolean };
  };
  assert.equal(tsconfig.compilerOptions?.sourceMap, false);
});

test("public application documentation is complete and has no broken local links", async () => {
  const requiredDocuments = [
    "README.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONFIGURATION.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/ARCHITECTURE.md",
    "docs/SETUP.md",
    "docs/SECRETS.md",
    "docs/COLLECTORS.md",
    "docs/SECURITY.md",
    "docs/DEVELOPMENT.md",
    "docs/TROUBLESHOOTING.md",
    "docs/RELEASING.md",
    "docs/ASSET-PROVENANCE.md",
    "docs/NAMING.md",
  ];

  for (const document of requiredDocuments) await access(join(dashboardRoot, document));

  for (const document of requiredDocuments) {
    const path = join(dashboardRoot, document);
    const content = await readFile(path, "utf8");
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].trim();
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const localTarget = decodeURIComponent(target.split("#", 1)[0]);
      await access(resolve(dirname(path), localTarget));
    }
  }
});

test("Apache licensing and release metadata cover source and both images", async () => {
  const license = await readFile(join(dashboardRoot, "LICENSE"), "utf8");
  const energyLicense = await readFile(join(dashboardRoot, "energy", "LICENSE"), "utf8");
  assert.equal(energyLicense, license);
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /3\. Grant of Patent License\./);
  assert.match(license, /END OF TERMS AND CONDITIONS/);

  const packageDocument = JSON.parse(await readFile(join(dashboardRoot, "package.json"), "utf8")) as {
    private?: boolean;
    license?: string;
    repository?: { url?: string };
  };
  assert.equal(packageDocument.private, true);
  assert.equal(packageDocument.license, "Apache-2.0");
  assert.equal(packageDocument.repository?.url, "git+https://github.com/d4rk22/ravenhill.git");

  for (const dockerfilePath of ["Dockerfile", "energy/Dockerfile"]) {
    const dockerfile = await readFile(join(dashboardRoot, dockerfilePath), "utf8");
    for (const label of [
      "org.opencontainers.image.version",
      "org.opencontainers.image.revision",
      "org.opencontainers.image.source",
      "org.opencontainers.image.licenses",
    ]) assert.match(dockerfile, new RegExp(label.replaceAll(".", "\\.")));
    assert.match(dockerfile, /COPY LICENSE NOTICE \/usr\/share\/licenses\/ravenhill\//);
  }
});

test("community health files and guarded SHA-pinned workflows are release-ready", async () => {
  const requiredFiles = [
    ".github/CODEOWNERS",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/dependabot.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ];
  for (const path of requiredFiles) await access(join(dashboardRoot, path));

  for (const path of requiredFiles.filter((value) => value.endsWith(".yml"))) {
    const document = parse(await readFile(join(dashboardRoot, path), "utf8"));
    assert.equal(typeof document, "object", `${path} must parse as YAML`);
  }

  const ci = await readFile(join(dashboardRoot, ".github/workflows/ci.yml"), "utf8");
  for (const check of ["Node / quality", "Python / quality", "Containers / build-and-smoke"]) {
    assert.match(ci, new RegExp(`name: ${check.replace("/", "\\/")}`));
  }
  assert.match(ci, /npm run check/);
  assert.match(ci, /python -m pip_audit --requirement energy\/requirements\.txt/);
  assert.match(ci, /--network none/);
  assert.match(ci, /--read-only/);
  assert.match(ci, /--cap-drop ALL/);
  assert.match(ci, /--security-opt no-new-privileges/);

  const release = await readFile(join(dashboardRoot, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /github\.repository == 'd4rk22\/ravenhill'/);
  assert.doesNotMatch(release, /workflow_dispatch/);
  assert.match(release, /ghcr\.io\/d4rk22\/ravenhill-\$\{\{ matrix\.component \}\}/);
  assert.match(release, /type=sha,prefix=sha-,format=long/);
  assert.match(release, /sbom: true/);
  assert.match(release, /provenance: mode=max/);
  assert.match(release, /subject-digest: \$\{\{ steps\.build\.outputs\.digest \}\}/);
  assert.match(release, /flavor: latest=false/);

  const actionReferences = [...`${ci}\n${release}`.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)];
  assert.ok(actionReferences.length >= 8);
  for (const reference of actionReferences) assert.match(reference[1], /^[0-9a-f]{40}$/);
});

test("every shipped first-party visual is inventoried and legacy gate assets are absent", async () => {
  const assets = (await readdir(join(dashboardRoot, "public", "assets"))).sort();
  assert.deepEqual(assets, ["storage-array.svg", "world-map.svg"]);

  const provenance = await readFile(join(dashboardRoot, "docs", "ASSET-PROVENANCE.md"), "utf8");
  for (const asset of assets) assert.match(provenance, new RegExp(`public/assets/${asset.replace(".", "\\.")}`));
  assert.match(provenance, /Inline data-URI favicon/);
  assert.match(provenance, /Regional lower-48 plate and state lines/);
  assert.match(provenance, /Great Lakes layer/);
  assert.match(provenance, /Traffic, capacity, workload, route, node, and label SVG groups/);
  assert.match(provenance, /Ravenhill ships no font file/);
  assert.match(provenance, /energy sidecar ships no application image, SVG, map, font, icon, or\s+derived visual/);
  assert.match(provenance, /Radarr poster bytes[\s\S]+are not in Git/);

  for (const removed of ["erebor-gate-original.png", "erebor-gate.svg"]) {
    await assert.rejects(access(join(dashboardRoot, "public", "assets", removed)));
    assert.match(provenance, new RegExp(removed.replace(".", "\\.")));
  }
});

test("dependency and base-image visuals have current provenance and explicit runtime decisions", async () => {
  const dockerfile = await readFile(join(dashboardRoot, "Dockerfile"), "utf8");
  const energyDockerfile = await readFile(join(dashboardRoot, "energy", "Dockerfile"), "utf8");
  const provenance = await readFile(join(dashboardRoot, "docs", "ASSET-PROVENANCE.md"), "utf8");
  const removedDependencyVisuals = [
    "node_modules/@fastify/send/test/fixtures/images/node-js.png",
    "node_modules/@fastify/static/example/public/images/sample.jpg",
    "node_modules/@fastify/static/test/content-type/sample.jpg",
    "node_modules/@fastify/static/test/static-pre-compressed/sample.jpg",
    "node_modules/@fastify/static/test/static/shallow/sample.jpg",
    "node_modules/fastify/docs/resources/encapsulation_context.svg",
    "node_modules/pino/favicon.ico",
    "/usr/local/lib/node_modules/npm/node_modules/qrcode-terminal/example/basic.png",
  ];

  for (const path of removedDependencyVisuals) {
    assert.match(dockerfile, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(provenance, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(provenance, /@fastify\/static@10\.1\.3/);
  assert.match(provenance, /fastify@5\.11\.3/);
  assert.doesNotMatch(provenance, /@fastify\/static@9\.3\.0|fastify@5\.10\.0/);
  assert.match(dockerfile, /rm -rf[\s\S]+\/opt\/yarn-v1\.22\.22[\s\S]+\/usr\/local\/lib\/node_modules\/npm/);
  assert.match(energyDockerfile, /FROM python:3\.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0/);
  assert.match(energyDockerfile, /\/usr\/local\/lib\/python3\.13\/idlelib/);
  assert.match(provenance, /14 small CPython IDLE icons/);
  assert.match(provenance, /python:3\.13-alpine@sha256:399babc8/);
  assert.match(provenance, /QR sample[\s\S]+whiteouted[\s\S]+raw layers/);
});

test("the runtime retains Ravenhill but contains no other reviewed Tolkien-derived names", async () => {
  const runtimePaths = [
    "public/app.js",
    "public/index.html",
    "public/privacy-mode.js",
    "public/styles.css",
    "public/assets/storage-array.svg",
  ];
  const reviewedTerms = [
    "Erebor",
    "dwarf",
    "Tolkien",
    "Hobbit",
    "Middle Earth",
    "Thorin Oakenshield",
    "Balin",
    "Dwalin",
    "Fíli",
    "Kíli",
    "Dori",
    "Nori",
    "Ori",
    "Óin",
    "Glóin",
    "Bifur",
    "Bofur",
    "Bombur",
    "Gimli",
    "Dáin Ironfoot",
    "Thráin",
    "Thrór",
    "Durin",
    "Fundin",
    "Narvi",
    "Flói",
    "Lóni",
    "Frár",
    "Náli",
  ];
  const runtime = (await Promise.all(runtimePaths.map(async (path) =>
    `${path}\n${await readFile(join(dashboardRoot, path), "utf8")}`))).join("\n");

  assert.match(runtime, /Ravenhill/);
  for (const term of reviewedTerms) {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(runtime, new RegExp(`(?<![\\p{L}\\p{N}])${escapedTerm}(?![\\p{L}\\p{N}])`, "iu"));
  }
});
