#!/usr/bin/env node
// `unset-rewrap` (P1.14d): the operator moves every sealed value to the active key after adding one, then
// `unset-rewrap --check <kid>` exits 0 once no value uses `kid`, and only then is that key removed from the keyring
// (runbook text in P5.06). It prints rows per key id, which are key names, never key material. Exit 0 ok, 1 values
// still use the checked kid, 2 bad arguments; a configuration problem exits 78 (bootOrExit).
import { sealFields } from "@unset/infrastructure-seal";
import { bootOrExit, defineConfig, oneOf, str } from "@unset/shared-config";
import { connectionOf, postgresFields } from "./config.ts";
import { createPool } from "./pool.ts";
import { checkExit, type KidCounts, kidCounts, rewrapAll } from "./rewrapAll.ts";

export const rewrapConfig = defineConfig({
  UNSET_ENV: oneOf(["dev", "test", "prod"]),
  UNSET_COMMIT: str({ pattern: /[0-9a-f]{40}/ }),
  ...postgresFields,
  ...sealFields,
});

const line = (counts: KidCounts): string =>
  `unset-rewrap: ${
    Object.entries(counts)
      .map(([kid, n]) => `${kid} ${n}`)
      .join(", ") || "no sealed values"
  }\n`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args[0] === "--check" && args.length === 2 ? args[1] : undefined;
  if (args.length > 0 && check === undefined) {
    process.stderr.write("usage: unset-rewrap [--check <kid>]\n");
    process.exit(2);
  }
  const cfg = bootOrExit(rewrapConfig);
  const pool = createPool({
    connection: connectionOf(cfg),
    service: "rewrap",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 60_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  try {
    const counts = check === undefined ? await rewrapAll(pool, cfg.SEAL_KEYRING) : await kidCounts(pool);
    process.stdout.write(line(counts));
    process.exitCode = check === undefined ? 0 : checkExit(counts, check);
  } finally {
    await pool.close();
  }
}
