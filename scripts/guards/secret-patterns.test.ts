// The custom gitleaks rules (P0.07) match the key formats they name and nothing nearby.
// Every key is built at run time, so no secret-shaped string is ever committed.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** The regex of each custom rule, read from .gitleaks.toml so the test checks what CI runs. */
function rules(): Map<string, RegExp> {
  const toml = readFileSync(join(ROOT, ".gitleaks.toml"), "utf8");
  const out = new Map<string, RegExp>();
  for (const block of toml.split("[[rules]]").slice(1)) {
    const id = /^id = "([^"]+)"/m.exec(block)?.[1];
    const regex = /^regex = '''(.+)'''$/m.exec(block)?.[1];
    if (id && regex) out.set(id, new RegExp(regex));
  }
  return out;
}

function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = BASE58[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
}

/** A base58btc multibase key: `z` + varint multicodec prefix + key bytes. */
const multibase = (prefix: number[], length: number): string =>
  `z${base58(Uint8Array.from([...prefix, ...randomBytes(length)]))}`;

const bech32Upper = (length: number): string =>
  Array.from(randomBytes(length), (b) => BECH32[b % 32])
    .join("")
    .toUpperCase();

const RULES = rules();
const rule = (id: string): RegExp => {
  const re = RULES.get(id);
  if (!re) throw new Error(`.gitleaks.toml has no rule ${id}`);
  return re;
};

describe("gitleaks custom rules", () => {
  test("every custom rule is present", () => {
    expect([...RULES.keys()]).toEqual([
      "unset-canary",
      "multibase-private-key",
      "age-secret-key",
      "age-plugin-identity",
    ]);
  });

  test("multibase_private_keys_match", () => {
    for (let i = 0; i < 50; i++) {
      expect(multibase([0x81, 0x26], 32)).toMatch(rule("multibase-private-key")); // secp256k1-priv
      expect(multibase([0x86, 0x26], 32)).toMatch(rule("multibase-private-key")); // p256-priv
    }
  });

  test("public_keys_and_digests_do_not_match", () => {
    for (let i = 0; i < 50; i++) {
      expect(`did:key:${multibase([0xe7, 0x01], 33)}`).not.toMatch(rule("multibase-private-key")); // zQ3s…
      expect(`did:key:${multibase([0x80, 0x24], 33)}`).not.toMatch(rule("multibase-private-key")); // zDn…
      expect(`sha256:${randomBytes(32).toString("hex")}`).not.toMatch(rule("multibase-private-key"));
    }
  });

  test("age_keys_match", () => {
    expect(`AGE-SECRET-KEY-1${bech32Upper(58)}`).toMatch(rule("age-secret-key"));
    expect(`AGE-PLUGIN-YUBIKEY-1${bech32Upper(30)}`).toMatch(rule("age-plugin-identity"));
    expect(`age1${bech32Upper(58).toLowerCase()}`).not.toMatch(rule("age-secret-key")); // a recipient is public
  });

  test("canary_matches", () => {
    expect(`UNSET_CANARY_${randomBytes(16).toString("hex")}`).toMatch(rule("unset-canary"));
  });
});
