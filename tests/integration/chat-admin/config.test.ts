// chat-admin's boot config (ADR 0081 decision 5): secrets from files, the door's key limited to session.end, MAS
// reached only at http origins, and a session lifetime that is always set and bounded.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BootError, readConfig } from "../../../interfaces/chat-admin/config.ts";
import { CLIENT_ID, tempDir } from "./harness.ts";

const pem = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

function setup(keys: unknown, env: Record<string, string> = {}) {
  const dir = tempDir();
  writeFileSync(join(dir, "chat_admin_client_secret"), "s3cret\n");
  writeFileSync(join(dir, "chat_admin_keys"), JSON.stringify(keys));
  return {
    CHAT_ADMIN_ENV: "dev",
    MAS_ADMIN_URL: "http://mas:8082",
    MAS_TOKEN_URL: "http://mas:8080",
    SYNAPSE_ADMIN_URL: "http://synapse-sweep:8008",
    MAS_CLIENT_ID: CLIENT_ID,
    STATE_DIR: dir,
    CHAT_ADMIN_SECRETS_DIR: dir,
    ...env,
  };
}
const good = () => [
  { kid: "web-1", iss: "web", publicKeyPem: pem(), verbs: ["account.create", "session.mint", "session.end"] },
  { kid: "door-1", iss: "door", publicKeyPem: pem(), verbs: ["session.end"] },
];

describe("config", () => {
  test("config.reads: keys, secret and a default lifetime", () => {
    const config = readConfig(setup(good()));
    expect(config.keys.map((k) => [k.kid, k.iss, k.verbs])).toEqual([
      ["web-1", "web", ["account.create", "session.mint", "session.end"]],
      ["door-1", "door", ["session.end"]],
    ]);
    expect(config.clientSecret).toBe("s3cret");
    expect(config.sessionTtl).toBe(86_400);
    // ADR 0091 decision 8: Synapse's listener on the network only chat-admin shares.
    expect(config.synapseUrl.href).toBe("http://synapse-sweep:8008/");
  });

  test.each([
    ["door may mint", [{ ...good()[1], verbs: ["session.end", "session.mint"] }]],
    ["unknown verb", [{ ...good()[0], verbs: ["user.reactivate"] }]],
    ["unknown issuer", [{ ...good()[0], iss: "admin" }]],
    ["not a list", {}],
  ])("config.keys_refused: %s", (_name, keys) => {
    expect(() => readConfig(setup(keys))).toThrow(BootError);
  });

  test.each([
    ["MAS_ADMIN_URL", "https://mas.example.com"],
    ["MAS_TOKEN_URL", "http://mas:8080/oauth2"],
    ["SYNAPSE_ADMIN_URL", "https://synapse.example.com"],
    ["SYNAPSE_ADMIN_URL", "http://synapse:8008/_synapse/admin"],
    ["SYNAPSE_ADMIN_URL", ""],
    ["MAS_CLIENT_ID", "not-a-ulid"],
    ["SESSION_TTL_SECONDS", "0"],
    ["CHAT_ADMIN_ENV", "staging"],
  ])("config.refused: %s", (name, value) => {
    expect(() => readConfig(setup(good(), { [name]: value }))).toThrow(BootError);
  });

  test("config.no_value_in_errors: an error names the setting, never its value", () => {
    expect(() => readConfig(setup(good(), { MAS_CLIENT_ID: "leaky-value" }))).toThrow(/^MAS_CLIENT_ID/);
    try {
      readConfig(setup(good(), { MAS_CLIENT_ID: "leaky-value" }));
    } catch (error) {
      expect(String(error)).not.toContain("leaky-value");
    }
  });
});
