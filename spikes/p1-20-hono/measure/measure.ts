// P1.20 step 4 for the Hono candidate. Writes raw reports to measure/out/raw/ and MEASUREMENTS.json derived only
// from them. Run from the spike folder: node measure/measure.ts
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createServer } from "vite";
import { runChromium } from "./browser.ts";

const OUT = "measure/out/raw";
rmSync("measure/out", { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2));
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { env: { ...process.env, ...env }, stdio: "pipe" }).toString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// f. build seconds, median of 3 clean builds (instrumented measurement config each time).
const seconds: number[] = [];
for (let i = 0; i < 3; i++) {
  rmSync("dist", { recursive: true, force: true });
  const start = performance.now();
  run("npx", ["vite", "build", "--config", "vite.measure.config.ts"], { SPIKE_INSTRUMENT: "1" });
  run("npx", ["vite", "build", "--config", "vite.measure.config.ts", "--ssr", "src/entry-server.tsx", "--outDir", "dist/server"], { SPIKE_INSTRUMENT: "1" });
  seconds.push((performance.now() - start) / 1000);
}
write("build-stats.json", { cleanBuildSeconds: seconds });

// b.i class maps from both production builds.
write("css-maps-prod-client.json", JSON.parse(readFileSync("dist/css-maps/client.json", "utf8")));
write("css-maps-prod-server.json", JSON.parse(readFileSync("dist/css-maps/server.json", "utf8")));

// e. gzip -9 of every client JS chunk, with the manifest to classify them.
const assets = "dist/client/assets";
const gzip: Record<string, number> = {};
for (const file of readdirSync(assets).filter((f) => f.endsWith(".js"))) {
  gzip[file] = gzipSync(readFileSync(join(assets, file)), { level: 9 }).length;
}
write("gzip.json", { level: 9, bytes: gzip });
write("client-manifest.json", JSON.parse(readFileSync("dist/client/.vite/manifest.json", "utf8")));

// b.ii-d production build in Chromium.
const prod = spawn("node", ["dist/server/entry-server.js"], { env: { ...process.env, PORT: "4173", SPIKE_TEST: "1" }, stdio: "inherit" });
await sleep(800);
try {
  await runChromium("http://localhost:4173", [
    { path: "/", interact: true },
    { path: "/@demo", interact: false },
    { path: "/neg", interact: false },
  ], join(OUT, "chromium-prod.json"));
  write("prod-html.json", {
    "/": await (await fetch("http://localhost:4173/")).text(),
    "/@demo": await (await fetch("http://localhost:4173/@demo")).text(),
  });
} finally {
  prod.kill();
}

// b.i dev: the class map Vite SSR loads vs the one the browser imports, for every CSS Module.
const vite = await createServer({ server: { port: 5173, strictPort: true }, logLevel: "error" });
await vite.listen();
try {
  const modules = Object.keys(JSON.parse(readFileSync("dist/css-maps/client.json", "utf8")));
  const devServer: Record<string, unknown> = {};
  for (const m of modules) devServer[m] = ((await vite.ssrLoadModule(`/${m}`)) as { default: unknown }).default;
  write("css-maps-dev-server.json", devServer);
  const report = await runChromium("http://localhost:5173", [{ path: "/", interact: true }], join(OUT, "chromium-dev.json"));
  void report;
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  await page.goto("http://localhost:5173/");
  const devClient: Record<string, unknown> = {};
  for (const m of modules) devClient[m] = await page.evaluate(async (u) => (await import(u)).default, `/${m}`);
  await browser.close();
  write("css-maps-dev-client.json", devClient);
} finally {
  await vite.close();
}

// f. dependencies of a clean install.
const parseable = run("npm", ["ls", "--all", "--parseable"]).trim().split("\n").slice(1);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
write("deps.json", {
  direct: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})],
  transitive: [...new Set(parseable.map((p) => p.slice(p.lastIndexOf("node_modules/") + 13)))].sort(),
});

// a. glue lines, with the repository's counter.
const glue = Number(run("node", ["../../scripts/budgets/count-glue-lines.ts", "src/glue", "--config", "vite.config.ts"]).trim());
const perFile: Record<string, number> = {};
for (const f of readdirSync("src/glue")) perFile[f] = Number(run("node", ["../../scripts/budgets/count-glue-lines.ts", "src/glue", "--config", "vite.config.ts"]).trim()) && Number(run("node", ["-e", `import('../../scripts/budgets/check.ts').then(m=>console.log(m.countLines(require('fs').readFileSync('src/glue/${f}','utf8'))))`]).trim());
write("glue.json", { total: glue, perFile, config: "vite.config.ts" });
console.log("raw reports written");
