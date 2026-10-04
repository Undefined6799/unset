// TE-1: production refuses to start with a fake wired, and never even loads the fake's module.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Records every URL the module loader resolves, so a fake that was loaded cannot hide. */
const RESOLVE_HOOK = `import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    appendFileSync(process.env.RESOLVE_LOG, result.url + "\\n");
    return result;
  },
});
`;

/** A composition root shaped like the real ones: the UNSET_ENV check runs before any import() of a fake. */
const FIXTURE_COMPOSE = `const fakes = (process.env.UNSET_FAKES ?? "").split(",").filter(Boolean);
if (fakes.length > 0 && process.env.UNSET_ENV === "prod") {
  console.error("config.fake_in_prod");
  process.exit(1);
}
for (const fake of fakes) await import(\`../../infrastructure/arachnid/\${fake}.fake.ts\`);
console.log("composed");
`;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fake-boot-"));
  temps.push(root);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ type: "module" }),
    "hook.mjs": RESOLVE_HOOK,
    "interfaces/demo/compose.ts": FIXTURE_COMPOSE,
    "infrastructure/arachnid/fingerprint-check.fake.ts": 'console.log("fake loaded");\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function boot(root: string, env: string, fakes: string) {
  const log = join(root, `resolved-${env}.log`);
  writeFileSync(log, "");
  const run = spawnSync(process.execPath, ["--import", "./hook.mjs", "interfaces/demo/compose.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH, UNSET_ENV: env, UNSET_FAKES: fakes, RESOLVE_LOG: log },
  });
  const resolved = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: run.status, stderr: run.stderr, fakesLoaded: resolved.filter((u) => u.endsWith(".fake.ts")) };
}

/** Real composition roots that name a fake. */
function realRootsWithFakes(): string[] {
  const interfaces = join(ROOT, "interfaces");
  if (!existsSync(interfaces)) return [];
  return readdirSync(interfaces)
    .map((name) => `interfaces/${name}/compose.ts`)
    .filter((file) => existsSync(join(ROOT, file)) && readFileSync(join(ROOT, file), "utf8").includes(".fake.ts"));
}

test("fake_boot_refused_in_prod", () => {
  const root = fixtureRoot();
  const prod = boot(root, "prod", "fingerprint-check");
  expect(prod.status).not.toBe(0);
  expect(prod.stderr).toContain("config.fake_in_prod");
  expect(prod.fakesLoaded).toEqual([]);

  // The control: outside prod the same root does load its fake, so the hook really sees fake URLs.
  const dev = boot(root, "dev", "fingerprint-check");
  expect(dev.status).toBe(0);
  expect(dev.fakesLoaded).toHaveLength(1);

  // No real root names a fake yet. The step that adds the first one wires its config's fake
  // selector into boot() here; until then this fails rather than passing over it unchecked.
  expect(realRootsWithFakes(), "teach fake_boot_refused_in_prod how these roots select a fake").toEqual([]);
});
