import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.js";
import { dashboardSnapshotSchema, demoStateSchema } from "../src/contracts/dashboard.js";
import { createDemoSnapshot } from "../src/demo.js";
import { publicConfiguration } from "../src/routes/configuration.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildSite(output = join(root, ".site-dist")) {
  // Explicit synthetic inputs only. Never consult operator config or environment.
  const configurationText = await readFile(join(root, "examples/showcase.yml"), "utf8");
  const config = loadConfig({}, { configurationText });
  if (config.document.mode !== "demo" || config.document.collectors.length || config.secrets.size) {
    throw new Error("Static site export requires credential-free demo configuration");
  }
  const fixture = dashboardSnapshotSchema.parse(JSON.parse(await readFile(join(root, "fixtures/dashboard-snapshot.json"), "utf8")));
  const snapshots = Object.fromEntries(demoStateSchema.options.map(state => [state, dashboardSnapshotSchema.parse(createDemoSnapshot(fixture, state))]));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(join(root, "site"), output, { recursive: true });
  await cp(join(root, "public"), join(output, "demo"), { recursive: true });
  const html = (await readFile(join(output, "demo/index.html"), "utf8"))
    .replace('<html lang="en">', '<html lang="en" data-static-demo="true">')
    .replaceAll('src="/assets/', 'src="./assets/')
    .replace('<body>', '<body>\n    <aside class="site-demo-nav" aria-label="About this demo"><a href="../">Hrafnholt home</a><span>Interactive demo · fictional data</span><a href="https://github.com/d4rk22/hrafnholt/blob/main/docs/SETUP.md">Set up your dashboard</a></aside>')
    .replace('</head>', '    <link rel="stylesheet" href="../demo-nav.css" />\n  </head>');
  if (!html.includes('data-static-demo="true"')) throw new Error("Could not mark static demo document");
  await writeFile(join(output, "demo/index.html"), html);
  await writeFile(join(output, "demo/data.json"), JSON.stringify({ configuration: publicConfiguration(config.document), snapshots }));
  await cp(join(root, "docs/images/dashboard-demo.png"), join(output, "dashboard.png"));
  await writeFile(join(output, ".nojekyll"), "");
  await writeFile(join(output, "build.json"), JSON.stringify({ version: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, commit: process.env.GITHUB_SHA ?? "local" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSite();
  console.log("Built static landing page and synthetic demo in .site-dist/");
}
