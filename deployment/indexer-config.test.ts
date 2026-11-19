// The indexer's environment in each stack that runs it, loaded through the indexer's own config schema
// (interfaces/indexer/config.ts), as web-config.test.ts does for web. A key the process requires and the stack does
// not set fails here, not as exit 78 on the VM (staging 2026-11-19: LISTEN_PORT missing, a restart loop). A
// `${NAME}` reference takes the example env file's placeholder; each `*_FILE` key must name one of the indexer's
// mounted secrets and points at a stand-in written per run. The config modules load by path, so this workspace takes
// no reference on interfaces/indexer.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type EnvValue, parseCompose, parseEnvFile } from "./preflight/compose-parse.ts";

const DEPLOYMENT = import.meta.dirname;
const REPOSITORY = join(DEPLOYMENT, "..");
const STANDINS = mkdtempSync(join(tmpdir(), "indexer-secrets-"));
afterAll(() => rmSync(STANDINS, { recursive: true, force: true }));

const EXAMPLE = "env/dev-public.example.env";
const example = new Map(parseEnvFile(readFileSync(join(DEPLOYMENT, EXAMPLE), "utf8"), EXAMPLE));

/** What each of the indexer's secrets holds; generated per run, never committed. */
const STANDIN: Record<string, () => string> = {
  pg_indexer_password: () => randomBytes(24).toString("base64url"),
};

/** The indexer's environment from one compose file, references resolved and secret files replaced by stand-ins. */
function indexerEnv(file: string): { env: Record<string, string>; secrets: string[] } {
  const compose = parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file);
  const indexer = compose.services.find((s) => s.name === "indexer");
  if (indexer === undefined) throw new Error(`${file} has no indexer service`);
  const value = (key: string, v: EnvValue): string => {
    if ("literal" in v) return v.literal;
    const resolved = example.get(v.ref);
    if (resolved === undefined) throw new Error(`${file}: indexer ${key} names \${${v.ref}}, which ${EXAMPLE} lacks`);
    return resolved;
  };
  const env = Object.fromEntries(indexer.environment.map(([key, v]) => [key, value(key, v)]));
  for (const [key, path] of Object.entries(env).filter(([key]) => key.endsWith("_FILE"))) {
    const name = path.replace(/^\/run\/secrets\//, "");
    if (!indexer.secrets.includes(name) || STANDIN[name] === undefined) throw new Error(`${file}: ${key} is ${path}`);
    const standin = join(STANDINS, `${file}-${name}`);
    writeFileSync(standin, STANDIN[name]());
    env[key] = standin;
  }
  return { env, secrets: indexer.secrets };
}

describe("the indexer's environment against its config", () => {
  for (const file of ["compose.local.yaml", "compose.dev.source.yaml"]) {
    test(`indexer_env_loads_its_config ${file}`, async () => {
      const { env, secrets } = indexerEnv(file);
      expect(secrets).toEqual(["pg_indexer_password"]);
      const { schema: config } = await import(join(REPOSITORY, "interfaces/indexer/config.ts"));
      const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
      // Unknown keys (NODE_OPTIONS) are the runtime's, not the process's; only refusals fail.
      expect(() => loadConfig(config, env, { onUnknownKeys: () => undefined })).not.toThrow();
    });
  }
});
