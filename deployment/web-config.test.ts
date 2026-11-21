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
  // Invite requests (P2.10u; ADR 0080): the provider's SMTP URL, its key in the login, and the owner's address.
  web_invite_request_smtp: () => ["smtps://resend", `${randomBytes(16).toString("hex")}@smtp.resend.com:465`].join(":"),
  web_invite_request_to: () => "owner@unset.example",
};

/** The secrets every stack mounts into web, and the two staging adds for invite requests (P2.10u). */
const WEB_SECRETS = [
  "pg_web_password",
  "web_seal_keyring",
  "web_oauth_client_keys",
  "web_pds_admin_key",
  "pds_web_key",
  "objects_web",
];
const INVITE_SECRETS = ["web_invite_request_smtp", "web_invite_request_to"];

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
      expect(secrets).toEqual(file === "compose.dev.yaml" ? [...WEB_SECRETS, ...INVITE_SECRETS] : WEB_SECRETS);
      const { schema: config } = await import(join(REPOSITORY, "interfaces/web/src/lib/server/config.ts"));
      const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
      // Unknown keys (NODE_OPTIONS, NODE_EXTRA_CA_CERTS) are the runtime's, not the server's; only refusals fail.
      expect(() => loadConfig(config, env, { onUnknownKeys: () => undefined })).not.toThrow();
    });
  }
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

describe("invite requests on the stacks", () => {
  // P2.10u (ADR 0080): staging asks for invites, so its web mounts the SMTP URL and the owner's address and says so in
  // a literal, a change someone reads in a PR. The local stack sends no mail (P1.36g) and leaves all of it out.
  for (const file of ["compose.dev.yaml", "compose.dev.source.yaml"]) {
    test(`invite_requests_are_on ${file}`, async () => {
      const { env, secrets } = webEnv(file);
      expect(env.INVITE_REQUESTS).toBe("on");
      expect(env.INVITE_REQUEST_FROM).toBe("noreply@staging.unset.sh");
      expect(secrets).toEqual(expect.arrayContaining(INVITE_SECRETS));
      const { schema: config } = await import(join(REPOSITORY, "interfaces/web/src/lib/server/config.ts"));
      const { loadConfig } = await import(join(REPOSITORY, "shared/config/index.ts"));
      expect(loadConfig(config, env, { onUnknownKeys: () => undefined }).INVITE_REQUESTS).toBe("on");
    });
  }

  test("invite_requests_are_off compose.local.yaml", () => {
    const { env, secrets } = webEnv("compose.local.yaml");
    expect(Object.keys(env).filter((key) => key.startsWith("INVITE_REQUEST"))).toEqual([]);
    expect(secrets.filter((name) => INVITE_SECRETS.includes(name))).toEqual([]);
  });
});
