// The indexer's pool must fit its role's connection limit across every replica a rollout may run, or
// checkConnectionBudget (infrastructure/postgres/pool.ts) refuses it at boot and the indexer exits 78 forever (Codex
// review on #1730). Read from the stacks that run it and from the migration that sets the limit, so either side
// changing alone fails here rather than on the VM.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCompose } from "./preflight/compose-parse.ts";

const DEPLOYMENT = import.meta.dirname;
const ROLES = join(DEPLOYMENT, "../infrastructure/postgres/migrations/0003_roles_and_grants.sql");
/** PG_MAX_REPLICAS's default (infrastructure/postgres/config.ts). */
const DEFAULT_REPLICAS = 3;

function indexerLimit(): number {
  const row = /\('indexer', true, (\d+),/.exec(readFileSync(ROLES, "utf8"));
  if (row?.[1] === undefined) throw new Error("no indexer row in 0003_roles_and_grants.sql");
  return Number(row[1]);
}

function literal(env: ReadonlyMap<string, { literal: string } | { ref: string }>, key: string): number | undefined {
  const value = env.get(key);
  return value !== undefined && "literal" in value ? Number(value.literal) : undefined;
}

describe.each(["compose.local.yaml", "compose.dev.source.yaml"])("%s", (file) => {
  test("indexer_pool_fits_its_role_connection_limit", () => {
    const compose = parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file);
    const indexer = compose.services.find((s) => s.name === "indexer");
    expect(indexer).toBeDefined();
    const env = new Map(indexer?.environment);
    const pool = literal(env, "PG_POOL_MAX");
    expect(pool).toBeDefined();
    const replicas = literal(env, "PG_MAX_REPLICAS") ?? DEFAULT_REPLICAS;
    expect(pool).toBeLessThanOrEqual(Math.floor(indexerLimit() / replicas));
  });
});

// chat-auth (the door) runs the same boot check (interfaces/chat-auth/compose.ts) against chat_auth's limit, set by
// migration 0044; staging's first start exited 78 on a pool of 5 against 10 / 3 (Alex, 2026-11-23).
const DOOR_ROLE = join(DEPLOYMENT, "../infrastructure/postgres/migrations/0044_door_browser.sql");

function doorLimit(): number {
  const row = /ALTER ROLE chat_auth LOGIN CONNECTION LIMIT (\d+);/.exec(readFileSync(DOOR_ROLE, "utf8"));
  if (row?.[1] === undefined) throw new Error("no chat_auth limit in 0044_door_browser.sql");
  return Number(row[1]);
}

describe("compose.dev.source.yaml chat-auth", () => {
  test("door_pool_fits_its_role_connection_limit", () => {
    const file = "compose.dev.source.yaml";
    const compose = parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file);
    const env = new Map(compose.services.find((s) => s.name === "chat-auth")?.environment);
    const pool = literal(env, "PG_POOL_MAX");
    expect(pool).toBeDefined();
    const replicas = literal(env, "PG_MAX_REPLICAS") ?? DEFAULT_REPLICAS;
    expect(pool).toBeLessThanOrEqual(Math.floor(doorLimit() / replicas));
  });
});
