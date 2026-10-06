// P1.20 step 6, the Astro day: the same fixture and checks as the Hono candidate, production build only.
// Run from this folder: node measure/measure.ts. Writes measure/out/raw/ and measure/out/MEASUREMENTS.json.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { countLines } from "../../../scripts/budgets/check.ts";
import { configLineSplit, FREE_DECLARATIVE_LINES } from "../../../scripts/budgets/count-glue-lines.ts";
import { cssMapMismatches } from "../../../scripts/docs/glue-spike.ts";
import { runChromium } from "../../p1-20-hono/measure/browser.ts";

const OUT = "measure/out/raw";
rmSync("measure/out", { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2));
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { env: { ...process.env, ...env }, stdio: "pipe" }).toString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seconds: number[] = [];
for (let i = 0; i < 3; i++) {
  rmSync("dist", { recursive: true, force: true });
  rmSync("dist-maps", { recursive: true, force: true });
  const start = performance.now();
  run("npx", ["astro", "build"], { SPIKE_MAPS: "1" });
  seconds.push((performance.now() - start) / 1000);
}
write("build-stats.json", { cleanBuildSeconds: seconds });

// Class maps from every build environment Astro ran (client and server), grouped by file.
const maps: Record<string, Record<string, string>[]> = {};
for (const f of readdirSync("dist-maps")) {
  const { file, json } = JSON.parse(readFileSync(join("dist-maps", f), "utf8"));
  (maps[file] ??= []).push(json);
}
write("css-maps-prod.json", maps);

const assets = "dist/client/_astro";
const gzip: Record<string, number> = {};
for (const file of readdirSync(assets).filter((f) => f.endsWith(".js"))) {
  gzip[file] = gzipSync(readFileSync(join(assets, file)), { level: 9 }).length;
}
write("gzip.json", { level: 9, bytes: gzip });

async function browse(name: string, env: Record<string, string>) {
  const server = spawn("node", ["dist/server/entry.mjs"], { env: { ...process.env, PORT: "4321", HOST: "127.0.0.1", ...env }, stdio: "ignore" });
  await sleep(1200);
  try {
    await runChromium("http://localhost:4321", [
      { path: "/", interact: true },
      { path: "/@demo", interact: false },
      { path: "/neg", interact: false },
    ], join(OUT, name));
    if (name === "chromium-prod.json") {
      write("prod-html.json", {
        "/": await (await fetch("http://localhost:4321/")).text(),
        "/@demo": await (await fetch("http://localhost:4321/@demo")).text(),
      });
    }
  } finally {
    server.kill();
  }
}
await browse("chromium-prod.json", {});
await browse("chromium-prod-no-csp.json", { SPIKE_NO_CSP: "1" });

const parseable = run("npm", ["ls", "--all", "--parseable"]).trim().split("\n").slice(1);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const direct = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].sort();
write("deps.json", {
  versions: Object.fromEntries(direct.map((n) => [n, JSON.parse(readFileSync(`node_modules/${n}/package.json`, "utf8")).version])),
  direct,
  transitive: [...new Set(parseable.map((p) => p.slice(p.lastIndexOf("node_modules/") + 13)))].sort(),
});
const config = configLineSplit("astro.config.mjs", readFileSync("astro.config.mjs", "utf8"));
write("glue.json", { files: { "src/middleware.ts": countLines(readFileSync("src/middleware.ts", "utf8")) }, configs: { "astro.config.mjs": config } });
console.log("raw reports written");
