// P1.39a (ADR 0046): the reviewed adapted configs compare equal to Caddy's output for an env's real values, in the
// two orders Caddy gives the same files, and to nothing else. The files themselves are proved against the built image
// in adapted.image.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ADAPTED_ENVS, type AdaptedEnvName, canonical, type Json, reviewedDifference, SENTINELS } from "./adapted.ts";
import { ENV_NAMES, type EnvName } from "./adapted-rules.ts";

const EDGE = import.meta.dirname;
const NAMES = Object.keys(ENV_NAMES) as EnvName[];
const reviewed = (env: AdaptedEnvName): Json =>
  JSON.parse(readFileSync(join(EDGE, "adapted", `${env}.generated.json`), "utf8")) as Json;
const REAL = {
  PDS_HOST: "staging.unset.ac",
  PDS_UPSTREAM: "pds:3000",
  ACME_EMAIL: "edge@unset.test",
  APP_HOST: "staging.unset.sh",
  APP_UPSTREAM: "web:8080",
  DOCS_HOST: "docs.unset.sh",
  CHAT_HOST: "staging.unset.cc",
  CHAT_UPSTREAM: "10.250.38.43:8090",
  MATRIX_UPSTREAM: "10.250.38.51:8008",
} as const;
/** What Caddy adapts for `env`'s values: the reviewed text with each sentinel replaced, as a plain text replace. */
const adaptedFor = (name: AdaptedEnvName, env: Readonly<Record<EnvName, string>>): Json =>
  JSON.parse(
    NAMES.reduce((text, each) => text.replaceAll(SENTINELS[each], env[each]), JSON.stringify(reviewed(name))),
  ) as Json;

type Server = {
  routes: Json[];
  errors?: { routes: Json[] };
  tls_connection_policies?: { match?: { sni?: string[] } }[];
};
/** The servers of a config, for a test to change in place. */
const servers = (config: Json): Server[] =>
  Object.values((config as { apps: { http: { servers: Record<string, Server> } } }).apps.http.servers);
const publicServer = (config: Json): Server => {
  const found = servers(config).find((server) => server.routes.length > 1);
  if (found === undefined) throw new Error("no server with two sites");
  return found;
};

describe("reviewed adapted configs (P1.39a)", () => {
  test("adapted_dir_holds_exactly_the_envs", () => {
    expect(readdirSync(join(EDGE, "adapted")).sort()).toEqual(
      ADAPTED_ENVS.map((env) => `${env}.generated.json`).sort(),
    );
  });

  test("adapted_sentinels_fit_their_shapes_and_stand_alone", () => {
    expect(Object.keys(SENTINELS).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      expect(SENTINELS[name], name).toMatch(ENV_NAMES[name]);
      for (const other of NAMES.filter((each) => each !== name)) {
        expect(SENTINELS[other].includes(SENTINELS[name]), `${name} in ${other}`).toBe(false);
      }
    }
    // No config file holds a sentinel, so every one in an adapted file came from a `{$NAME}` placeholder.
    const sources = [
      "Caddyfile",
      "sites/pds.caddy",
      "dev/app.caddy",
      "dev/pds.caddy",
      "dev/chat.caddy",
      "dev/tls.caddy",
    ]
      .concat(["local/app.caddy", "local/tls.caddy"])
      .concat(readdirSync(join(EDGE, "snippets")).map((file) => `snippets/${file}`));
    for (const file of sources) {
      const text = readFileSync(join(EDGE, file), "utf8");
      for (const name of NAMES) expect(text.includes(SENTINELS[name]), `${name} in ${file}`).toBe(false);
    }
  });

  test("adapted_reviewed_equals_itself_and_its_real_values", () => {
    for (const env of ADAPTED_ENVS) {
      expect(reviewedDifference(reviewed(env), reviewed(env), SENTINELS), env).toBeNull();
      expect(reviewedDifference(adaptedFor(env, REAL), reviewed(env), REAL), env).toBeNull();
    }
  });

  // Caddy v2.11.7 puts the longer host's site first, so a long PDS host swaps the two site routes, their error routes
  // (checked on v2.11.9, 2026-11-19, Codex on #1739) and the SNI names
  // (observed with the pinned build, 2026-11-15: PDS_HOST of 43 characters beside an APP_HOST of 4).
  test("adapted_site_order_caddy_derives_from_host_length_is_equal", () => {
    for (const env of ["dev", "local"] as const) {
      const swapped = adaptedFor(env, REAL);
      const server = publicServer(swapped);
      server.routes.reverse();
      server.errors?.routes.reverse();
      for (const policy of server.tls_connection_policies ?? []) policy.match?.sni?.reverse();
      expect(canonical(swapped), env).not.toBe(canonical(adaptedFor(env, REAL)));
      expect(reviewedDifference(swapped, reviewed(env), REAL), env).toBeNull();
    }
  });

  test("adapted_any_other_config_differs", () => {
    const different: [string, (config: Json) => void][] = [
      ["a key the review did not see", (config) => Object.assign(config as object, { storage: {} })],
      ["the admin API on", (config) => Object.assign(config as object, { admin: {} })],
      ["a site route removed", (config) => void publicServer(config).routes.pop()],
      [
        "a site route that is not terminal",
        (config) => delete (publicServer(config).routes[0] as { terminal?: boolean }).terminal,
      ],
      ["an added first route", (config) => void publicServer(config).routes.unshift({ handle: [] })],
      [
        "a third server",
        (config) =>
          Object.assign((config as { apps: { http: { servers: object } } }).apps.http.servers, {
            extra: { listen: [":80"] },
          }),
      ],
      ["no tls app", (config) => delete (config as { apps: { tls?: Json } }).apps.tls],
      ["an error route removed", (config) => void publicServer(config).errors?.routes.pop()],
      [
        "an error route that is not terminal",
        (config) =>
          delete ((publicServer(config).errors as { routes: Json[] }).routes[0] as { terminal?: boolean }).terminal,
      ],
    ];
    for (const [what, change] of different) {
      const config = adaptedFor("dev", REAL);
      change(config);
      expect(reviewedDifference(config, reviewed("dev"), REAL), what).toBe(
        "the edge config Caddy adapts is not the reviewed one",
      );
    }
  });

  test("adapted_any_one_value_changed_differs", () => {
    // Any one value changed anywhere: every string, number and boolean leaf of the prod config, one at a time.
    const text = JSON.stringify(adaptedFor("prod", REAL));
    const leaves = [...text.matchAll(/(?<=[:[,])("(?:[^"\\]|\\.)*"|-?\d+|true|false)(?=[,\]}])/g)];
    expect(leaves.length).toBeGreaterThan(100);
    for (const leaf of leaves) {
      const at = leaf.index;
      const changed = leaf[0].startsWith('"')
        ? '"changed"'
        : leaf[0] === "true"
          ? "false"
          : leaf[0] === "false"
            ? "true"
            : "7";
      const config = JSON.parse(`${text.slice(0, at)}${changed}${text.slice(at + leaf[0].length)}`) as Json;
      expect(reviewedDifference(config, reviewed("prod"), REAL), `${leaf[0]} at ${at}`).not.toBeNull();
    }
  });

  test("adapted_values_of_another_env_differ", () => {
    const other = { ...REAL, PDS_UPSTREAM: "web:8080", APP_UPSTREAM: "pds:3000" };
    expect(reviewedDifference(adaptedFor("dev", other), reviewed("dev"), REAL)).not.toBeNull();
    // A value the env does not give leaves the sentinel in place, which no real config holds.
    const { ACME_EMAIL: _unset, ...withoutEmail } = REAL;
    expect(reviewedDifference(adaptedFor("prod", REAL), reviewed("prod"), withoutEmail)).not.toBeNull();
  });

  test("adapted_difference_message_carries_no_value", () => {
    const config = adaptedFor("dev", REAL);
    publicServer(config).routes.pop();
    const reason = reviewedDifference(config, reviewed("dev"), REAL) ?? "";
    for (const name of NAMES) expect(reason.includes(REAL[name]), name).toBe(false);
  });
});
