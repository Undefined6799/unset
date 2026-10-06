// P1.14: the `s1` envelope, the keyring, contexts, rotation and the per-kid count. The known answer was computed
// independently with Python's `cryptography` 49.0.0 AESGCM (scratch script, not committed), so the format is pinned
// against a second implementation, not against this one.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { ConfigError, defineConfig, loadConfig } from "@unset/shared-config";
import { describe, expect, test, vi } from "vitest";
import { type SealContext, sealContext } from "./context.ts";
import { type Keyring, parseKeyring, sealFields } from "./keyring.ts";
import { SealError } from "./seal.ts";
import { createSealer } from "./sealer.ts";

const key = (fill: number): string => Buffer.alloc(32, fill).toString("base64");
const keyring = (active: string, keys: Record<string, string>): Keyring =>
  parseKeyring(JSON.stringify({ active, keys })) as Keyring;
const K1 = keyring("k1", { k1: key(1) });
const A1 = sealContext("app.oauth_sessions.token_set", "1");
const MIB = 1024 * 1024;

/** The code a call fails with, or "ok". */
function codeOf(call: () => unknown): string {
  try {
    call();
    return "ok";
  } catch (error) {
    return error instanceof SealError ? error.code : String(error);
  }
}

describe("seal", () => {
  test("roundtrip", () => {
    const sealer = createSealer(K1);
    for (const size of [0, 1, MIB]) {
      const plaintext = new Uint8Array(size).fill(7);
      expect(Buffer.from(sealer.unseal(sealer.seal(plaintext, A1), A1)).equals(Buffer.from(plaintext))).toBe(true);
    }
    expect(sealer.unsealJson(sealer.sealJson({ access: "t", n: 1 }, A1), A1)).toEqual({ access: "t", n: 1 });
  });

  test("too_large", () => {
    expect(codeOf(() => createSealer(K1).seal(new Uint8Array(MIB + 1), A1))).toBe("seal.too_large");
  });

  test("fresh_dek_and_iv", () => {
    const sealer = createSealer(K1);
    const [a, b] = [sealer.seal(Buffer.from("same"), A1), sealer.seal(Buffer.from("same"), A1)];
    expect(a).not.toBe(b);
    expect(new Set([...a.split(".").slice(2), ...b.split(".").slice(2)]).size).toBe(8);
  });

  test("context_bound", () => {
    const sealer = createSealer(K1);
    const sealed = sealer.seal(Buffer.from("token"), A1);
    expect(codeOf(() => sealer.unseal(sealed, sealContext("app.oauth_sessions.token_set", "2")))).toBe(
      "seal.auth_failed",
    );
    expect(codeOf(() => sealer.unseal(sealed, sealContext("app.oauth_sessions.dpop_key", "1")))).toBe(
      "seal.auth_failed",
    );
  });

  test("context_is_branded", () => {
    const sealer = createSealer(K1);
    // @ts-expect-error A free string is not a SealContext; only sealContext makes one.
    expect(codeOf(() => sealer.seal(Buffer.from("x"), "app.t.c|1"))).toBe("ok");
    // A cast past the type is still checked at run time, so an empty or malformed context never seals or opens.
    for (const bad of ["", "app.t.c", "app.t.c|", "x|1", "app.t.c|a|b"]) {
      expect(
        codeOf(() => sealer.seal(Buffer.from("x"), bad as SealContext)),
        bad,
      ).toBe("seal.format");
      expect(
        codeOf(() => sealer.unseal(sealer.seal(Buffer.from("x"), A1), bad as SealContext)),
        bad,
      ).toBe("seal.format");
    }
    const typed: SealContext = sealContext("app.t.c", "1");
    expect(typed).toBe("app.t.c|1");
  });

  test("context_rowkey_rules", () => {
    for (const rowKey of ["", "a|b", "tab\there", "é"]) expect(() => sealContext("app.t.c", rowKey), rowKey).toThrow();
    for (const column of ["t.c", "app.t.c.d", "App.t.c", "app.t.c|x"]) expect(() => sealContext(column, "1")).toThrow();
    expect(sealContext("app.t.c", "did:plc:abc 1~")).toBe("app.t.c|did:plc:abc 1~");
  });

  test.each([2, 3, 4, 5])("tamper_each_part %i", (part) => {
    const sealer = createSealer(K1);
    const parts = sealer.seal(Buffer.from("secret"), A1).split(".");
    const bytes = Buffer.from(parts[part] as string, "base64url");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    parts[part] = bytes.toString("base64url");
    expect(["seal.auth_failed", "seal.format"]).toContain(codeOf(() => sealer.unseal(parts.join("."), A1)));
  });

  test("malformed_values", () => {
    const sealer = createSealer(K1);
    const good = sealer.seal(Buffer.from("x"), A1);
    for (const bad of ["", "s1", good.replace(/^s1/, "s2"), `${good}.x`, good.replace(/\.[^.]+$/, ".a=")])
      expect(
        codeOf(() => sealer.unseal(bad, A1)),
        bad,
      ).toBe("seal.format");
  });

  test("unknown_kid", () => {
    const sealed = createSealer(K1)
      .seal(Buffer.from("x"), A1)
      .replace(/^s1\.k1\./, "s1.zz.");
    expect(codeOf(() => createSealer(K1).unseal(sealed, A1))).toBe("seal.unknown_kid");
  });

  test("rotation", () => {
    const sealed = createSealer(K1).seal(Buffer.from("old"), A1);
    const both = createSealer(keyring("k2", { k1: key(1), k2: key(2) }));
    expect(Buffer.from(both.unseal(sealed, A1)).toString()).toBe("old");
    const rewrapped = both.rewrap(sealed);
    expect(rewrapped.startsWith("s1.k2.")).toBe(true);
    expect(rewrapped.split(".").slice(4)).toEqual(sealed.split(".").slice(4));
    expect(both.rewrap(rewrapped)).toBe(rewrapped);
    const onlyK2 = createSealer(keyring("k2", { k2: key(2) }));
    expect(Buffer.from(onlyK2.unseal(rewrapped, A1)).toString()).toBe("old");
    expect(codeOf(() => onlyK2.unseal(sealed, A1))).toBe("seal.unknown_kid");
  });

  test("keyring_validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "seal-"));
    const load = (contents: string) => {
      const path = join(dir, "keyring");
      writeFileSync(path, contents);
      chmodSync(path, 0o600);
      return loadConfig(defineConfig(sealFields), { SEAL_KEYRING_FILE: path });
    };
    expect(load(JSON.stringify({ active: "k1", keys: { k1: key(1) } })).SEAL_KEYRING.active).toBe("k1");
    const bad = [
      { active: "k9", keys: { k1: key(1) } },
      { active: "k1", keys: { k1: Buffer.alloc(31, 1).toString("base64") } },
      { active: "k1", keys: Object.fromEntries(["k1", "k2", "k3", "k4", "k5"].map((kid) => [kid, key(1)])) },
      { active: "K1", keys: { K1: key(1) } },
      { active: "k1", keys: {} },
      { active: "k1", keys: { k1: key(1) }, extra: true },
    ];
    for (const value of bad) expect(() => load(JSON.stringify(value)), JSON.stringify(value)).toThrow(ConfigError);
    expect(() => load("not json")).toThrow(ConfigError);
    expect(() => loadConfig(defineConfig(sealFields), { SEAL_KEYRING: "{}" })).toThrow(ConfigError);
  });

  test("keyring_never_printed", () => {
    const ring = keyring("k1", { k1: key(65) });
    const printed = [String(ring), JSON.stringify({ ring }), inspect(ring), inspect({ ring }, { showHidden: true })];
    for (const text of printed) expect(text).not.toContain(key(65).slice(0, 8));
  });

  test("count_metric", () => {
    const sealer = createSealer(K1);
    for (let i = 0; i < 3; i++) sealer.seal(Buffer.from("x"), A1);
    expect(sealer.countByKid()).toEqual(new Map([["k1", 3]]));
  });

  test("never_logged", () => {
    const sealer = createSealer(K1);
    const sealed = sealer.seal(Buffer.from("token"), A1);
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const spies = [vi.spyOn(process.stdout, "write").mockImplementation(capture)];
    spies.push(vi.spyOn(process.stderr, "write").mockImplementation(capture));
    let error: unknown;
    try {
      sealer.unseal(sealed, sealContext("app.oauth_sessions.token_set", "2"));
    } catch (caught) {
      error = caught;
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const shown = [...written, String(error), JSON.stringify(error), inspect(error), (error as Error).stack ?? ""];
    for (const part of sealed.split(".").slice(1)) for (const text of shown) expect(text).not.toContain(part);
    expect((error as SealError).code).toBe("seal.auth_failed");
  });

  test("known_answer", () => {
    // DEK 100..131, wrap IV 0x07 × 12, data IV 0x09 × 12, KEK 0..31; random bytes are handed out in that order.
    const queue = [
      Buffer.from(Array.from({ length: 32 }, (_, i) => 100 + i)),
      Buffer.alloc(12, 7),
      Buffer.alloc(12, 9),
    ];
    const random = (bytes: number) => {
      const next = queue.shift() as Buffer;
      expect(next.length).toBe(bytes);
      return next;
    };
    const ring = keyring("k1", { k1: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64") });
    const context = sealContext("app.oauth_sessions.token_set", "did:plc:abcdefghijklmnopqrstuvwx");
    const sealed = createSealer(ring, random).seal(Buffer.from("hello seal"), context);
    expect(sealed).toBe(
      "s1.k1.BwcHBwcHBwcHBwcH.aw_AOwdmvZ-q8H3v8CCG6NUp-wTwjvtigsYghYRfsJgXKc_9npWgjur4GMNvyZ-u" +
        ".CQkJCQkJCQkJCQkJ.QXm6grvtIq8-hgWUREUYKYwhyESdcyM3E1w",
    );
    expect(Buffer.from(createSealer(ring).unseal(sealed, context)).toString()).toBe("hello seal");
  });
});
