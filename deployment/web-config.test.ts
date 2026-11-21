// P2.04w: the web service's environment in both compose files satisfies the web server's config schema
// (interfaces/web/src/lib/server/config.ts since P1.20j; interfaces/http's before), so a key the server needs and the stack does not set fails here, not at the container's
// first boot. A `${NAME}` reference takes the example env file's placeholder; each `*_FILE` key must name one of web's
// mounted secrets, and points at a stand-in written per run in the shape its reader parses (the real files live beside
// the checkout, docs/human/runbooks/dev-stack-secrets.md). The config modules load by path, as the query budget test
// loads them, so this workspace takes no reference on interfaces/web.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type EnvValue, parseCompose, parseEnvFile } from "./preflight/compose-parse.ts";

const DEPLOYMENT = import.meta.dirname;
const REPOSITORY = join(DEPLOYMENT, "..");
const STANDINS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(STANDINS, { recursive: true, force: true }));

const EXAMPLE = "env/dev-public.example.env";
const example = new Map(parseEnvFile(readFileSync(join(DEPLOYMENT, EXAMPLE), "utf8"), EXAMPLE));

/** What each of web's secrets holds, in the shape its reader parses; generated per run, never committed. */
const STANDIN: Record<string, () => string> = {
  pg_web_password: () => randomBytes(24).toString("base64url"),
  web_seal_keyring: () => JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }),
  web_oauth_client_keys: () => {
    const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
    return JSON.stringify([{ ...jwk, kid: example.get("WEB_OAUTH_ACTIVE_KID"), alg: "ES256" }]);
  },
  web_pds_admin_key: () => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  pds_web_key: () => randomBytes(32).toString("hex"),
  objects_web: () => randomBytes(32).toString("hex"),
  draft_url_keyring: () => JSON.stringify({ active: "d1", keys: { d1: randomBytes(32).toString("base64") } }),
};

/** web's environment from one compose file, every reference resolved and every secret file replaced by a stand-in. */
function webEnv(file: string): { env: Record<string, string>; secrets: string[] } {
  const web = parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file).services.find((s) => s.name === "web");
  if (web === undefined) throw new Error(`${file} has no web service`);
  const value = (key: string, v: EnvValue): string => {
    if ("literal" in v) return v.literal;
    const resolved = example.get(v.ref);
    if (resolved === undefined) throw new Error(`${file}: web's ${key} names \${${v.ref}}, which ${EXAMPLE} lacks`);
    return resolved;
  };
  const env = Object.fromEntries(web.environment.map(([key, v]) => [key, value(key, v)]));
  for (const [key, path] of Object.entries(env).filter(([key]) => key.endsWith("_FILE"))) {
    const name = path.replace(/^\/run\/secrets\//, "");
    if (!web.secrets.includes(name) || STANDIN[name] === undefined) throw new Error(`${file}: ${key} is ${path}`);
    const standin = join(STANDINS, `${file}-${name}`);
    writeFileSync(standin, STANDIN[name]());
    env[key] = standin;
  }
  return { env, secrets: web.secrets };
}

describe("web's environment against its config", () => {
  for (const file of ["compose.dev.yaml", "compose.local.yaml"]) {
    test(`web_env_loads_its_config ${file}`, async () => {
      const { env, secrets } = webEnv(file);
      expect(secrets).toEqual([
        "pg_web_password",
        "web_seal_keyring",
        "web_oauth_client_keys",
        "web_pds_admin_key",
        "pds_web_key",
        "objects_web",
        "draft_url_keyring",
      ]);
      const { schema: config } = await import(join(REPOSITORY, "interfaces/web/src/lib/server/config.ts"));
      const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
      // Unknown keys (NODE_OPTIONS, NODE_EXTRA_CA_CERTS) are the runtime's, not the server's; only refusals fail.
      expect(() => loadConfig(config, env, { onUnknownKeys: () => undefined })).not.toThrow();
    });
  }
});

describe("draft link keys (book P2.19)", () => {
  // config.draft_keys_distinct: a link key that is also a seal key would let whoever holds one forge the other's
  // values, so web refuses to boot, whatever the kids are called.
  test("web_refuses_draft_keys_that_share_a_seal_key", async () => {
    const { env } = webEnv("compose.local.yaml");
    const { schema: config } = await import(join(REPOSITORY, "interfaces/web/src/lib/server/config.ts"));
    const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
    const load = (draft: string) => {
      const path = join(STANDINS, "shared-draft-keys");
      writeFileSync(path, draft);
      return () => loadConfig(config, { ...env, DRAFT_URL_KEYRING_FILE: path }, { onUnknownKeys: () => undefined });
    };
    const seal = JSON.parse(readFileSync(env.SEAL_KEYRING_FILE ?? "", "utf8")) as { keys: Record<string, string> };
    const sealKey = Object.values(seal.keys)[0] ?? "";
    expect(load(JSON.stringify({ active: "d1", keys: { d1: sealKey } }))).toThrow(/DRAFT_URL_KEYRING/);
    const own = randomBytes(32).toString("base64");
    expect(load(JSON.stringify({ active: "d1", keys: { d1: own, d2: sealKey } }))).toThrow(/DRAFT_URL_KEYRING/);
    expect(load(JSON.stringify({ active: "d1", keys: { d1: own } }))).not.toThrow();
  });
});

describe("search and AI listing on the stacks", () => {
  // P1.21b: staging and local are never listed. The setting defaults to off; each stack also says so in its file, so
  // turning it on is a change someone reads in a PR. compose.dev.source.yaml builds the same stack from source.
  for (const file of ["compose.dev.yaml", "compose.dev.source.yaml", "compose.local.yaml"]) {
    test(`listing_is_off ${file}`, async () => {
      const { env } = webEnv(file);
      expect(env.SEARCH_LISTING).toBe("off");
      const { schema: config } = await import(join(REPOSITORY, "interfaces/web/src/lib/server/config.ts"));
      const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
      const { SEARCH_LISTING: _set, ...unset } = env;
      expect(loadConfig(config, unset, { onUnknownKeys: () => undefined }).SEARCH_LISTING).toBe("off");
    });
  }
});
