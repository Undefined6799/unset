import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { createLogger, type LogFields, scrub } from "./index.ts";

/** A logger writing into an array, with a fixed clock. */
function capture(env: "dev" | "test" | "prod" = "test") {
  const lines: string[] = [];
  const log = createLogger({
    service: "http",
    commit: "a".repeat(40),
    env,
    write: (line) => lines.push(line),
    now: () => new Date("2026-10-04T00:00:00Z"),
  });
  const records = (): Record<string, unknown>[] => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines, records };
}

describe("logger", () => {
  test("logger_line_shape", () => {
    const { log, lines, records } = capture();
    log.info("config.unknown_keys", { count: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    expect(records()).toEqual([
      {
        ts: "2026-10-04T00:00:00.000Z",
        level: "info",
        svc: "http",
        commit: "a".repeat(40),
        event: "config.unknown_keys",
        count: 2,
      },
    ]);
  });

  test("logger_drops_unlisted", () => {
    const { log, records } = capture();
    log.warn("config.unknown_keys", { ip: "1.2.3.4", ua: "Mozilla/5.0", path: "/@alice" } as unknown as LogFields);
    const [record] = records();
    expect(record).not.toHaveProperty("ip");
    expect(record).not.toHaveProperty("ua");
    expect(record).not.toHaveProperty("path");
    expect(record?.dropped).toBe(3);
  });

  test("logger_drops_non_primitive_values", () => {
    const { log, records } = capture();
    log.info("config.unknown_keys", { reason: { nested: "1.2.3.4" } } as unknown as LogFields);
    expect(records()[0]).toMatchObject({ dropped: 1 });
    expect(records()[0]).not.toHaveProperty("reason");
  });

  test.each([
    ["ipv4", "from 10.0.0.1 today"],
    ["ipv6 with zone", "peer 2001:db8::1%eth0"],
    ["ipv6 compressed", "::1"],
    ["email", "mail a@b.c now"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    ["bearer", "Bearer abc"],
    ["hex run", "f".repeat(64)],
    ["base64url run", "Ab-_".repeat(10)],
    ["did:key", `did:key:z${"6Mk".repeat(15)}`],
  ])("logger_scrubs_values %s", (_kind, value) => {
    // scrub guards stack frame paths and free string fields; the word fields refuse these values whole (P1.03w).
    const out = scrub(value);
    expect(out).toContain("[redacted]");
    const secretPart = value.replace(/^(from|peer|mail|Bearer) /, "").replace(/ (today|now)$/, "");
    expect(out).not.toContain(secretPart);
  });

  test("logger_truncates_and_strips_control_characters", () => {
    const reason = scrub(`a\nb\u0000c\u0085d${"x ".repeat(200)}`);
    expect(reason.startsWith("a?b?c?d")).toBe(true);
    expect(reason.length).toBe(200);
  });

  test("logger_one_line", () => {
    const { log, lines } = capture();
    log.error("error", { reason: "line one\nline two" });
    expect(lines[0]?.trimEnd().includes("\n")).toBe(false);
  });

  test("logger_route_template_only", () => {
    const { log, records } = capture();
    log.info("config.unknown_keys", { route: "/@:handle" });
    log.info("config.unknown_keys", { route: "/search?q=alice" });
    expect(records().map((r) => r.route)).toEqual(["/@:handle", "[route]"]);
  });

  test("logger_unknown_event", () => {
    const { log, records } = capture();
    log.info("user.did:plc:abcdefghijklmnopqrstuvwx logged in" as never);
    const [record] = records();
    expect(record?.event).toBe("log.unknown_event");
    expect(Array.from(String(record?.kind)).length).toBeLessThanOrEqual(40);
    expect(String(record?.kind)).not.toContain("did:plc");
  });

  test("logger_http_kit_events", () => {
    // P1.04k's server kit logs these; each must keep its own name rather than read as log.unknown_event.
    const { log, records } = capture();
    const events = ["http.request", "http.deadline", "http.late_result", "http.listen_failed", "http.drain"] as const;
    for (const event of events) log.info(event, { route: "/@:handle", method: "GET", status: 200, ms: 3 });
    expect(records().map((r) => r.event)).toEqual([...events]);
  });

  test("logger_trusted_proxy_event", () => {
    // P1.05's trusted proxy logs this, without an address, when a request did not come from the edge.
    const { log, records } = capture();
    log.warn("proxy.untrusted_peer");
    expect(records().map((r) => r.event)).toEqual(["proxy.untrusted_peer"]);
  });

  test("logger_rate_limit_events", () => {
    // P1.06's rate limiter logs these when it denies by failing closed: no session for a per-DID limit, or an error.
    const { log, records } = capture();
    log.error("ratelimit.no_session", { route: "/follow" });
    log.error("ratelimit.error", { reason: "bucket" });
    expect(records().map((r) => r.event)).toEqual(["ratelimit.no_session", "ratelimit.error"]);
  });

  test("logger_csrf_event", () => {
    // P1.07's CSRF gate logs each denial with its reason (a fixed word such as "origin_mismatch"), never a header value.
    const { log, records } = capture();
    log.warn("csrf.denied", { route: "/follow", reason: "origin_mismatch" });
    expect(records().map((r) => [r.event, r.reason])).toEqual([["csrf.denied", "origin_mismatch"]]);
  });

  test("logger_csp_event", () => {
    // P1.08's security headers log this, with the route template only, when a handler's own CSP was replaced.
    const { log, records } = capture();
    log.warn("csp.handler_override", { route: "/@:handle" });
    expect(records().map((r) => [r.event, r.route])).toEqual([["csp.handler_override", "/@:handle"]]);
  });

  test("logger_migrate_events", () => {
    // P1.11's migration runner logs these: versions and a SQLSTATE, never a Postgres message.
    const { log, records } = capture();
    log.warn("migrate.database_ahead", { count: 1, version: 3 });
    log.error("migrate.failed", { version: 2, sqlstate: "42P01" });
    log.info("migrate.done", { count: 2 });
    expect(records().map((r) => [r.event, r.version, r.sqlstate, r.count])).toEqual([
      ["migrate.database_ahead", 3, undefined, 1],
      ["migrate.failed", 2, "42P01", undefined],
      ["migrate.done", undefined, undefined, 2],
    ]);
  });

  test("logger_island_event", () => {
    // P1.23's island renderer logs this with the island name only; anything not shaped like a name is replaced.
    const { log, records } = capture();
    log.warn("island.props_too_large", { island: "header-menu" });
    for (const island of ["Header", "did:plc:abc", "a b", "@alice.example", `x${"y".repeat(41)}`]) {
      log.warn("island.props_too_large", { island });
    }
    expect(records().map((r) => [r.event, r.island])).toEqual([
      ["island.props_too_large", "header-menu"],
      ...Array(5).fill(["island.props_too_large", "[island]"]),
    ]);
  });

  test("logger_single_use_events", () => {
    // P1.16 logs a refused token with its reason word and its purpose as `kind` (dots become underscores, since
    // `kind` holds a name); a token, a DID or free text in either field is replaced.
    const { log, records } = capture();
    log.info("single_use.rejected", { reason: "reused", kind: "login_nonce" });
    log.warn("single_use.claim_clamped", { kind: "service_auth_jti" });
    log.info("single_use.rejected", { reason: "did:plc:abc", kind: "q2Vt-9x_Zk0aB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q" });
    expect(records().map((r) => [r.event, r.reason, r.kind])).toEqual([
      ["single_use.rejected", "reused", "login_nonce"],
      ["single_use.claim_clamped", undefined, "service_auth_jti"],
      ["single_use.rejected", "[reason]", "[kind]"],
    ]);
  });

  test("logger_lock_events", () => {
    // P1.17 logs the lock's namespace as `kind`, never its key; a DID in `kind` is replaced.
    const { log, records } = capture();
    log.warn("lock.hold_exceeded", { kind: "oauth", ms: 30000 });
    log.warn("lock.lost", { kind: "oauth" });
    log.warn("lock.lost", { kind: "did:plc:abc" });
    expect(records().map((r) => [r.event, r.kind, r.ms])).toEqual([
      ["lock.hold_exceeded", "oauth", 30000],
      ["lock.lost", "oauth", undefined],
      ["lock.lost", "[kind]", undefined],
    ]);
  });

  test("logger_sqlstate_is_a_code_only", () => {
    // A message or anything else in the sqlstate field is replaced, so error text cannot leak through it.
    const { log, records } = capture();
    for (const sqlstate of ['relation "users" does not exist', "42p01", "42P0", "42P011", "did:plc:abc"]) {
      log.error("migrate.failed", { version: 2, sqlstate });
    }
    expect(records().map((r) => r.sqlstate)).toEqual(Array(5).fill("[sqlstate]"));
  });

  test("logger_version_is_a_non_negative_integer", () => {
    // Anything but a non-negative safe integer is dropped, not coerced.
    const { log, records } = capture();
    for (const version of [-1, 1.5, Number.NaN, 2 ** 53, "2"]) {
      log.error("migrate.failed", { version } as unknown as LogFields);
    }
    log.error("migrate.failed", { version: 0 });
    expect(records().map((r) => [r.version, r.dropped])).toEqual([...Array(5).fill([undefined, 1]), [0, undefined]]);
  });

  test("logger_migrate_failure_keeps_no_row_values", () => {
    // A failing statement's driver error echoes row values in message, detail, hint, where and constraint. Logged
    // the way the runner logs it (version, SQLSTATE, then logError), none of that text reaches the line.
    const did = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
    const handle = "alice.example.com";
    const failure = Object.assign(new Error(`duplicate key value violates unique constraint "accounts_${handle}"`), {
      code: "23505",
      detail: `Key (did, handle)=(${did}, ${handle}) already exists.`,
      hint: `Remove ${handle} first.`,
      where: `SQL statement "INSERT INTO accounts VALUES ('${did}')"`,
      constraint: `accounts_${handle}`,
    });
    const { log, lines } = capture("prod");
    log.error("migrate.failed", { version: 2, sqlstate: failure.code });
    log.error("migrate.failed", { version: 2, sqlstate: failure.detail });
    log.logError(failure);
    const text = lines.join("");
    expect(text).toContain('"sqlstate":"23505"');
    expect(text).not.toContain(did);
    expect(text).not.toContain(handle);
    expect(text).not.toContain("ewvi7n");
  });

  test("unknown_event_kind_placeholder", () => {
    const { log, records } = capture();
    log.info("user.alice.0x40.me signed in" as never, { kind: "TypeError" });
    expect(records()[0]).toMatchObject({ event: "log.unknown_event", kind: "[event]" });
  });

  test("word_fields_refuse_identifiers", () => {
    const identifiers = [
      "alice.0x40.me",
      "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
      "alice@example.com",
      "203.0.113.7",
      "2001:db8::1",
      "https://example.com/a?b=c",
    ];
    for (const field of ["reason", "phase", "job", "kind", "key"] as const) {
      const { log, records } = capture();
      for (const value of identifiers) log.info("config.unknown_keys", { [field]: value });
      expect(records().map((r) => r[field])).toEqual(identifiers.map(() => `[${field}]`));
    }
    const { log, records } = capture();
    log.info("config.invalid", { key: "pg_host", reason: "Invalid", phase: "a".repeat(33) });
    expect(records()[0]).toMatchObject({ key: "[key]", reason: "[reason]", phase: "[phase]" });
  });

  test("word_fields_keep_words", () => {
    // Every value logged in these fields on main, plus the migrate runner's reasons (P1.11, #80).
    const words: Record<"reason" | "phase" | "job" | "kind" | "key", string[]> = {
      reason: [
        ...["sfs_cross_site", "sfs_same_site", "origin_mismatch", "origin_null", "referer_mismatch", "no_signal"],
        ...["error", "missing", "invalid", "unreadable", "forbidden_in_env"],
        ...["bad_file_name", "duplicate_version", "gap", "no_phase_header", "connect_failed", "not_migrator"],
        ...["lock_timeout", "checksum_mismatch", "sql_error", "sql_error_partial", "lint_drop", "lint_index_comment"],
        "lint_index_query_file",
      ],
      phase: ["start", "done", "timeout", "expand", "contract"],
      job: ["retention-sweep", "erase_storage"],
      kind: ["listen", "TypeError", "Error", "AppError", "AggregateError", "string", "undefined"],
      key: ["PG_HOST", "UNSET_COMMIT", "NETGUARD_INTERNAL_HOSTS", "LISTEN_PORT"],
    };
    for (const [field, values] of Object.entries(words)) {
      const { log, records } = capture();
      for (const value of values) log.info("config.unknown_keys", { [field]: value });
      expect(records().map((r) => r[field])).toEqual(values);
    }
  });

  test("logger_no_stack_message_in_prod", () => {
    const { log, lines } = capture("prod");
    log.logError(new Error("secret value"));
    expect(lines.join("")).not.toContain("secret value");
    expect(lines.join("")).not.toContain("stack");
    const dev = capture("dev");
    dev.log.logError(new AppError("csrf.denied", { cause: new Error("secret value") }));
    const [record] = dev.records();
    expect(record).toMatchObject({ event: "error", code: "csrf.denied", kind: "AppError" });
    expect(String(record?.stack)).toMatch(/logger\.test\.ts:\d+/);
    expect(dev.lines.join("")).not.toContain("secret value");
  });

  test("logger_survives_epipe", () => {
    const log = createLogger({
      service: "http",
      commit: "a".repeat(40),
      env: "prod",
      write: () => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
    });
    expect(() => log.info("config.unknown_keys")).not.toThrow();
  });
});
