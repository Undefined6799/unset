// P1.14d: a seal context comes only from a registered column and a row key, so two columns or two rows never share
// one, and a value sealed for one cannot be opened as another (step book P1.14d; P1.14 "Contexts are not free strings").
import { createSealer, type Keyring, parseKeyring, SealError } from "@unset/infrastructure-seal";
import { describe, expect, test } from "vitest";
import { contextIn, parseRegistry, SEALED_COLUMNS, type SealedRegistry } from "./sealedColumns.ts";

const REGISTRY: SealedRegistry = {
  "app.oauth_session.token_set": { rowKey: "id" },
  "app.oauth_session.dpop_key": { rowKey: "id" },
  "app.legal_hold.media_key": { rowKey: "subject_ref", form: "sealToStream" },
};
const keyring = parseKeyring(
  JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 1).toString("base64") } }),
) as Keyring;
const sealer = createSealer(keyring);

describe("sealed column contexts", () => {
  test("columns_and_rows_get_distinct_contexts", () => {
    const own = contextIn(REGISTRY, "app.oauth_session.token_set", "1");
    const others = [
      contextIn(REGISTRY, "app.oauth_session.token_set", "2"),
      contextIn(REGISTRY, "app.oauth_session.dpop_key", "1"),
    ];
    expect(new Set([own, ...others]).size).toBe(3);
    const sealed = sealer.seal(Buffer.from("token"), own);
    expect(Buffer.from(sealer.unseal(sealed, own)).toString()).toBe("token");
    for (const other of others) {
      expect(() => sealer.unseal(sealed, other)).toThrow(new SealError("seal.auth_failed"));
    }
  });

  test("unregistered_column_refused", () => {
    expect(() => contextIn(REGISTRY, "app.oauth_session.other", "1")).toThrow(/not in sealed-columns\.json/);
    expect(() => contextIn(REGISTRY, "toString", "1")).toThrow(/not in sealed-columns\.json/);
  });

  test("row_key_rules", () => {
    expect(() => contextIn(REGISTRY, "app.oauth_session.token_set", "")).toThrow();
    expect(() => contextIn(REGISTRY, "app.oauth_session.token_set", "a|b")).toThrow();
  });

  test("registry_shape", () => {
    expect(parseRegistry(REGISTRY)).toEqual(REGISTRY);
    expect(parseRegistry(SEALED_COLUMNS)).toEqual(SEALED_COLUMNS);
    for (const bad of [
      [],
      { "app.t": { rowKey: "id" } },
      { "app.t.c": {} },
      { "app.t.c": { rowKey: "Id" } },
      { "app.t.c": { rowKey: "id", form: "sealed" } },
      { "app.t.c": { rowKey: "id", extra: true } },
    ]) {
      expect(() => parseRegistry(bad), JSON.stringify(bad)).toThrow(/sealed-columns\.json/);
    }
  });
});
