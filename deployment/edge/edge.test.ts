// P1.28: what the edge's files must say, read without starting Caddy (the running edge is tested in
// tests/integration/deployment/edge/). Certificates come from Let's Encrypt only; the rate limiter keeps client
// addresses in memory and nowhere else (ADR 0018, invariant 3); the image is built from pinned versions only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ADAPTED_ENVS, type AdaptedEnvName, type Json, SENTINELS } from "./adapted.ts";
import { adaptedProblems, DEV_APP, DEV_DOCS, DEV_MEDIA } from "./adapted-rules.ts";

const EDGE = import.meta.dirname;
const read = (file: string): string => readFileSync(join(EDGE, file), "utf8");
const dockerfile = read("Dockerfile");
const lock = JSON.parse(readFileSync(join(EDGE, "..", "images", "bases.lock.json"), "utf8")) as Record<
  string,
  { ref: string; tag: string; digest: string; source: string }
>;

/**
 * BuildKit's line continuation for the default `\` escape: a backslash ending the line, spaces or tabs after it, that
 * is not itself escaped, so `x=\\` continues nothing (moby/buildkit master frontend/dockerfile/parser/parser.go:168,
 * setEscapeToken; read 2026-10-27). Its comment says it misreads an escaped backslash before a continuation (`\\\`);
 * the edge test copies that reading rather than guess another, and edge_dockerfile_only_what_the_rules_read keeps the
 * rest of the file within what these simple rules read.
 */
const CONTINUES = /([^\\])\\[ \t]*$|^\\[ \t]*$/;

/**
 * The final stage's RUN instructions before USER, each with its continuation lines joined by newlines. Keywords are
 * matched in any case with any whitespace after them, and a line continues only after one ending in an unescaped
 * backslash (CONTINUES; moby/buildkit frontend/dockerfile/docs/reference.md, "Format" and "escape", read 2026-10-12).
 */
const runsBeforeUser = (text: string): string[] => {
  const runtime = text.split(/^FROM\s.*$/im).at(-1) ?? "";
  const instructions: string[] = [];
  let continued = false;
  for (const line of runtime.split("\n")) {
    if (!continued && (line.trim() === "" || /^\s*#/.test(line))) continue;
    instructions.push(continued ? `${instructions.pop() ?? ""}\n${line}` : line);
    continued = CONTINUES.test(line);
  }
  const user = instructions.findIndex((instruction) => /^\s*USER\s/i.test(instruction));
  return instructions.slice(0, user === -1 ? undefined : user).filter((instruction) => /^\s*RUN\s/i.test(instruction));
};
/** The one copy from a build stage: the Caddy binary xcaddy built (P1.34j item 2). */
const BINARY_COPY = "COPY --from=build /out/caddy /usr/bin/caddy";

/**
 * The instructions, continuation lines joined (CONTINUES), and comment and blank lines skipped inside one as outside
 * it, as BuildKit skips them (parser.go, isComment and isEmptyContinuationLine). Simple on purpose: it is sound only on
 * text that is printable ASCII and LF, where a space is the only blank, and dockerfileShapeProblems refuses the rest.
 */
function logicalInstructions(text: string): string[] {
  const out: string[] = [];
  let open: string | undefined;
  for (const line of text.split("\n")) {
    if (/^ *(?:#.*)?$/.test(line)) continue;
    const continued = CONTINUES.test(line);
    const piece = continued ? line.replace(CONTINUES, "$1") : line;
    open = open === undefined ? piece.trimStart() : open + piece;
    if (!continued) {
      out.push(open);
      open = undefined;
    }
  }
  return open === undefined ? out : [...out, open];
}

/** The words before the first that is not a `--` flag: BuildKit reads only those as flags (split_command.go). */
function leadingFlags(rest: string): string[] {
  const words = rest.split(" ").filter((word) => word !== "");
  const end = words.findIndex((word) => !word.startsWith("--"));
  return end === -1 ? words : words.slice(0, end);
}

/** What one joined instruction may not hold (P1.34j items 2, 4, 5 and 7); fixed words. */
function instructionShapeProblems(instruction: string): string[] {
  const [, keyword = "", rest = ""] = /^(\S*)\s*(.*)$/.exec(instruction) ?? [];
  const copies = /^(?:COPY|ADD)$/i.test(keyword);
  const problems: string[] = [];
  // A heredoc's body bypasses every line rule here (reference.md, "Here-Documents").
  if ((copies || /^RUN$/i.test(keyword)) && instruction.includes("<<")) problems.push("a heredoc");
  if (/--mount/i.test(instruction)) problems.push("a --mount flag");
  if (copies && leadingFlags(rest).some((flag) => /["'\\]/.test(flag))) {
    problems.push("a COPY or ADD flag with a quote or backslash");
  }
  return problems;
}

/**
 * What the edge Dockerfile may not hold, so the line rules in this file read it as BuildKit does (P1.34j; architecture
 * 2026-10-13 00:58Z: restricting the input beats mirroring BuildKit's parser). Each reason is fixed words.
 */
function dockerfileShapeProblems(text: string): string[] {
  const problems = new Set<string>();
  // BuildKit splits on unicode.IsSpace and skips such lines inside a continuation (parser.go); any byte beyond
  // printable ASCII and LF is refused, so no blank, CR or line separator can hide an instruction (N8, N9).
  if (/[^\x20-\x7e\n]/.test(text)) problems.add("a byte outside printable ASCII and LF");
  // A parser directive comes before the first instruction; `escape` swaps the continuation character and `syntax`
  // swaps the parser (reference.md, "Parser directives").
  const head = text.split("\n").filter((_, at, lines) => lines.slice(0, at).every((l) => /^\s*(?:#.*)?$/.test(l)));
  if (head.some((line) => /^\s*#\s*(?:syntax|escape)\s*=/i.test(line))) problems.add("a parser directive");
  const all = logicalInstructions(text);
  for (const problem of all.flatMap(instructionShapeProblems)) problems.add(problem);
  // Every copy from a build stage is the one binary copy, in any case or flag order (items 2 and 5).
  const fromCopies = all.filter((instruction) => /--from/i.test(instruction));
  if (fromCopies.join("\n") !== BINARY_COPY) problems.add("a COPY --from other than the binary");
  return [...problems];
}

/** The setcap line as P1.28o wrote it; Amendment 3 keeps it unchanged. */
const SETCAP_RUN = [
  "RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \\",
  "    && apk del --no-network curl libcap \\",
  "    && rm -rf /usr/share/caddy /etc/caddy \\",
  "    && apk del --no-network apk-tools",
].join("\n");

/** The image each FROM names, stage names left out. */
const froms = (text: string): string[] =>
  [...text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/gim)].map((m) => m[1] ?? "");

type Obj = { [key: string]: Json };
const isObj = (value: Json | undefined): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * The edge config as Caddy adapts it for one env's files (P1.39d; ADR 0046): the reviewed adapted/<env>.generated.json,
 * which adapted.image.test.ts holds equal to what the built image adapts, with SENTINELS for the configured values.
 */
const reviewed = (env: AdaptedEnvName): Obj => JSON.parse(read(`adapted/${env}.generated.json`)) as Obj;
/** Every object in a config, at any depth. */
function objects(value: Json): Obj[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  return isObj(value) ? [value, ...Object.values(value).flatMap(objects)] : [];
}
/** Every handler of one module in a config, wherever it sits (Caddy v2.11.7 modules/caddyhttp, `handler` inline key). */
const handlers = (config: Json, name: string): Obj[] => objects(config).filter((each) => each.handler === name);
/** The value at a path of keys, or undefined. */
const at = (value: Json | undefined, ...keys: string[]): Json | undefined =>
  keys.reduce<Json | undefined>((each, key) => (isObj(each) ? each[key] : undefined), value);

type ZoneValue = { events: number; window: string };
/** Whether each event at `times` (ms, ascending) passes one client's zone, as caddy-ratelimit's ring buffer decides. */
function allowedAt(zone: ZoneValue, times: readonly number[]): boolean[] {
  const windowMs = nanoseconds(zone.window) / 1_000_000;
  const ring: number[] = Array(zone.events).fill(Number.NEGATIVE_INFINITY);
  let cursor = 0;
  return times.map((at) => {
    if (at - (ring[cursor] ?? 0) <= windowMs) return false;
    ring[cursor] = at;
    cursor = (cursor + 1) % ring.length;
    return true;
  });
}

/** A window as limits.json writes it (`5m`, `24h`, `10s`), in the nanoseconds Caddy adapts a duration to. */
function nanoseconds(window: string): number {
  const [, count, unit] = /^(\d+)([smh])$/.exec(window) ?? [];
  const seconds = { s: 1, m: 60, h: 3600 }[unit as "s" | "m" | "h"];
  if (count === undefined || seconds === undefined) throw new Error(`limits.json window ${window} is not Ns, Nm or Nh`);
  return Number(count) * seconds * 1_000_000_000;
}

/**
 * Why an adapted config could keep or share a rate-limit key beyond memory; empty when it cannot. The names are the
 * limiter's JSON fields (mholt/caddy-ratelimit 5625512f24f6 handler.go: `distributed`, `storage`, `log_key`,
 * `disable_metrics`); `storage` at the top is Caddy's own, and a `metrics` key anywhere turns metrics on.
 */
function memoryOnlyProblems(config: Json): string[] {
  const found: string[] = [];
  const limiters = handlers(config, "rate_limit");
  if (limiters.some((limiter) => "distributed" in limiter)) found.push("config sets distributed");
  if (limiters.some((limiter) => "storage" in limiter) || at(config, "storage") !== undefined) {
    found.push("config sets storage");
  }
  if (limiters.some((limiter) => "log_key" in limiter)) found.push("config sets log_key");
  if (objects(config).some((each) => "metrics" in each)) found.push("config enables global metrics");
  if (limiters.some((limiter) => limiter.disable_metrics !== true)) found.push("rate_limit without disable_metrics");
  return found;
}

/** Why the Dockerfile's Go build is not pinned and checked; empty when Caddy and the plugin are. */
function pinProblems(text: string): string[] {
  const instructions = text.replaceAll(/^\s*#.*$/gm, "");
  const found = [];
  if (!/^RUN xcaddy build v2\.11\.9 \\$/m.test(instructions)) found.push("Caddy version not pinned");
  if (!/--with github\.com\/mholt\/caddy-ratelimit@v0\.1\.1-0\.20260612195517-5625512f24f6 \\$/m.test(instructions))
    found.push("plugin pseudo-version not pinned");
  if ([...instructions.matchAll(/--with /g)].length !== 1) found.push("not exactly one plugin");
  if (!/^ENV GOFLAGS=-mod=readonly$/m.test(instructions)) found.push("GOFLAGS is not exactly -mod=readonly");
  // The checksum database and the default proxy stay on.
  for (const unsafe of ["GONOSUMDB", "GONOSUMCHECK", "GOINSECURE", "GOPRIVATE", "GONOPROXY", "GOSUMDB", "GOPROXY"]) {
    if (instructions.includes(unsafe)) found.push(`sets ${unsafe}`);
  }
  if (/-insecure|XCADDY_GO_BUILD_FLAGS|XCADDY_GO_MOD_FLAGS/.test(instructions)) found.push("insecure build flag");
  return found;
}

describe("edge config", () => {
  test("edge_tls_issuer_letsencrypt", () => {
    // What ships (prod) gets its certificate for the PDS host from Let's Encrypt, with the contact address from the
    // env, never committed: the sentinel stands where {$ACME_EMAIL} was.
    expect(at(reviewed("prod"), "apps", "tls")).toEqual({
      automation: {
        policies: [
          {
            subjects: [SENTINELS.PDS_HOST],
            issuers: [
              { module: "acme", ca: "https://acme-v02.api.letsencrypt.org/directory", email: SENTINELS.ACME_EMAIL },
            ],
          },
        ],
      },
    });
    // No other CA anywhere, in any env: that policy holds the only issuer, there is no pki app (Caddy's internal CA),
    // and dev and local serve the leaf files alone (ADR 0032; refocus Amendment 1).
    for (const env of ADAPTED_ENVS) {
      const config = reviewed(env);
      expect(Object.keys(at(config, "apps") as Obj).sort(), env).toEqual(["http", "tls"]);
      expect(objects(config).filter((each) => "issuers" in each).length, env).toBe(env === "prod" ? 1 : 0);
      expect(JSON.stringify(config), env).not.toMatch(/zerossl|"internal"|acme_ca|local_certs/i);
    }
    for (const env of ["dev", "local"] as const) {
      expect(at(reviewed(env), "apps", "tls"), env).toEqual({
        certificates: {
          load_files: [
            { certificate: `/run/secrets/${env}_tls_cert`, key: `/run/secrets/${env}_tls_key`, tags: ["cert0"] },
          ],
        },
      });
    }
  });

  test("edge_ratelimit_memory_only", () => {
    for (const env of ADAPTED_ENVS) {
      const config = reviewed(env);
      expect(memoryOnlyProblems(config), env).toEqual([]);
      // Every zone is keyed by the client address, IPv6 by its /64; web's marked zones by one fixed key (ADR 0071).
      const zones = handlers(config, "rate_limit").flatMap((limiter) => Object.entries(limiter.rate_limits as Obj));
      expect(zones.length, env).toBeGreaterThan(0);
      for (const [name, zone] of zones) {
        const web = name.startsWith("web_");
        expect(at(zone, "key"), `${env} ${name}`).toBe(web ? "web" : "{http.vars.client_ip}");
        expect(at(zone, "ipv6_prefix"), `${env} ${name}`).toBe(web ? undefined : 64);
      }
    }
    // A config with shared state, storage, a logged key or metrics fails.
    const edited = (edit: (config: Obj, limiter: Obj) => void): Obj => {
      const config = reviewed("prod");
      edit(config, handlers(config, "rate_limit")[0] as Obj);
      return config;
    };
    for (const fixture of [
      edited((_config, limiter) => {
        limiter.distributed = {};
      }),
      edited((config) => {
        config.storage = { module: "file_system", root: "/data" };
      }),
      edited((_config, limiter) => {
        limiter.storage = { module: "file_system", root: "/data" };
      }),
      edited((_config, limiter) => {
        limiter.log_key = true;
      }),
      edited((config) => {
        (at(config, "apps", "http") as Obj).metrics = {};
      }),
    ]) {
      expect(memoryOnlyProblems(fixture)).not.toEqual([]);
    }
    const withMetrics = edited((_config, limiter) => {
      delete limiter.disable_metrics;
    });
    expect(memoryOnlyProblems(withMetrics)).toEqual(["rate_limit without disable_metrics"]);
  });

  test("edge_ratelimit_matches_limits", () => {
    // The zone values are architecture's (record 2026-10-07-p1b-a1-pds-no-forwarded-address, 01:52Z), kept once in
    // limits.json; what Caddy adapts must say the same, for the PDS's zones and the dev app site's.
    const limits = JSON.parse(read("limits.json")) as Record<
      string,
      Record<string, { events: number; window: string }>
    >;
    const ruled = (zones: Record<string, { events: number; window: string }>) =>
      Object.fromEntries(
        Object.entries(zones).map(([name, zone]) => [name, { events: zone.events, window: nanoseconds(zone.window) }]),
      );
    const adapted = (env: AdaptedEnvName) =>
      handlers(reviewed(env), "rate_limit").map((limiter) =>
        Object.fromEntries(
          Object.entries(limiter.rate_limits as Obj).map(([name, zone]) => [
            name,
            { events: at(zone, "max_events"), window: at(zone, "window") },
          ]),
        ),
      );
    const pds = ruled(limits.rateLimitZones as Record<string, { events: number; window: string }>);
    const app = ruled(limits.appRateLimitZones as Record<string, { events: number; window: string }>);
    const docs = ruled(limits.docsRateLimitZones as Record<string, { events: number; window: string }>);
    const media = ruled(limits.mediaRateLimitZones as Record<string, { events: number; window: string }>);
    expect(adapted("prod")).toEqual([pds]);
    // Dev: the app site's own zones, the PDS's, the docs site's (P1.21w) and the media site's (P2.19). Local: both
    // sites count on the PDS's zones (local/app.caddy).
    expect(adapted("dev")).toEqual(expect.arrayContaining([app, pds, docs, media]));
    expect(adapted("dev").length).toBe(4);
    expect(adapted("local")).toEqual([pds, pds]);
  });

  test("app_burst_lets_a_member_click_four_times_a_second_and_refuses_a_flood", () => {
    // P1.20o/P1.20r (Alex 2026-11-19 13:17:24Z: "increase it from 20 to 60"): at 20 per 10 s a member pressing
    // Settings and Profile fast was refused. A warm client navigation is one request (its __data.json) and a cold
    // page at most five (ratelimit.caddy's count; under the split client its build files count in app_files), so a
    // cold page then four clicks a second for ten seconds must all pass, and a flood one past the zone must not.
    const zone = (JSON.parse(read("limits.json")) as { appRateLimitZones: Record<string, ZoneValue> }).appRateLimitZones
      .app_burst;
    if (zone === undefined) throw new Error("no app_burst zone in limits.json");
    const coldPage = [0, 0, 0, 0, 0];
    const clicks = Array.from({ length: 40 }, (_, i) => 250 * (i + 1));
    expect(allowedAt(zone, [...coldPage, ...clicks]).filter((ok) => !ok)).toEqual([]);
    const flood = allowedAt(zone, Array(zone.events + 1).fill(0));
    expect(flood.at(-1)).toBe(false);
    expect(flood.slice(0, -1).every(Boolean)).toBe(true);
  });

  test("app_files_lets_two_cold_browsers_load_at_once_and_refuses_a_flood", () => {
    // P1.21g (ADR 0069): under the split client a cold app page asks for up to 30 hashed build files at once (27
    // scripts on the heaviest route, the stylesheet and two icons; scripts/budgets/app-js.ts lists them) and its
    // document, its data and the two fonts, which stay in app_burst. Two members behind one address opening a cold page
    // in the same second, and then a third page each with ten new pieces, must all pass; a flood one past the zone must
    // not. The zone is caddy-ratelimit's ring buffer (5625512f24f6 ringbuffer.go:66-84): `events` slots of times, an
    // event is allowed when the slot under the cursor is older than the window, and only an allowed event takes a slot.
    const zones = (JSON.parse(read("limits.json")) as { appRateLimitZones: Record<string, ZoneValue> })
      .appRateLimitZones;
    const files = zones.app_files;
    const burst = zones.app_burst;
    if (files === undefined || burst === undefined) throw new Error("no app_files or app_burst zone in limits.json");
    const coldPageFiles = 30;
    const twoColdBrowsers = Array(2 * coldPageFiles).fill(0);
    const nextPages = Array.from({ length: 2 * 10 }, (_, i) => 1_000 + 100 * i);
    expect(allowedAt(files, [...twoColdBrowsers, ...nextPages]).filter((ok) => !ok)).toEqual([]);
    const flood = allowedAt(files, Array(files.events + 1).fill(0));
    expect(flood.at(-1)).toBe(false);
    expect(flood.slice(0, -1).every(Boolean)).toBe(true);
    // What app_burst sees of the same two cold pages: two documents and two fonts each, none of the files.
    expect(allowedAt(burst, Array(2 * 3).fill(0)).every(Boolean)).toBe(true);
  });

  test("edge_web_key_zones_are_exact", () => {
    // ADR 0071: web's mark is the fixed ends around hex and the key file's content between them. global and
    // oauth_token skip only a marked call, web_global and web_oauth_token take only one, keyed "web"; every upstream
    // deletes the header; no key value is in any config.
    const mark = {
      header: { "X-Unset-Web-Key": ["key-{file./run/secrets/pds_web_key}-key"] },
      header_regexp: { "X-Unset-Web-Key": { pattern: "^key-[0-9a-f]+-key$" } },
    };
    const tokenPaths = ["/oauth/token", "/xrpc/com.atproto.server.refreshSession"];
    for (const env of ADAPTED_ENVS) {
      const config = reviewed(env);
      const pds = handlers(config, "rate_limit")
        .map((limiter) => limiter.rate_limits as Obj)
        .filter((zones) => "global" in zones);
      expect(pds.length, env).toBeGreaterThan(0);
      for (const zones of pds) {
        expect(at(zones, "global", "match"), env).toEqual([{ not: [mark] }]);
        expect(at(zones, "oauth_token", "match"), env).toEqual([{ not: [mark], path: tokenPaths }]);
        expect(at(zones, "web_global", "match"), env).toEqual([mark]);
        expect(at(zones, "web_oauth_token", "match"), env).toEqual([{ ...mark, path: tokenPaths }]);
      }
      for (const proxy of handlers(config, "reverse_proxy")) {
        expect(at(proxy, "headers", "request", "delete"), env).toContain("X-Unset-Web-Key");
      }
      expect(JSON.stringify(config), env).not.toMatch(/key-[0-9a-f]{64}-key/);
    }
    // The rules refuse a loosened mark: a wildcard, no hex pattern, or a web zone keyed per address.
    const edited = (edit: (zones: Obj) => void): Json => {
      const config = reviewed("prod");
      const zones = handlers(config, "rate_limit")
        .map((limiter) => limiter.rate_limits as Obj)
        .find((each) => "global" in each);
      if (zones === undefined) throw new Error("no PDS zones");
      edit(zones);
      return config;
    };
    for (const fixture of [
      edited((zones) => {
        ((at(zones, "web_global", "match") as Obj[])[0] as Obj).header = { "X-Unset-Web-Key": ["*"] };
      }),
      edited((zones) => {
        delete ((at(zones, "web_global", "match") as Obj[])[0] as Obj).header_regexp;
      }),
      edited((zones) => {
        (zones.web_oauth_token as Obj).key = "{http.vars.client_ip}";
      }),
      edited((zones) => {
        delete (zones.global as Obj).match;
        delete (zones.oauth_token as Obj).match;
      }),
    ]) {
      expect(adaptedProblems(fixture, "shipped", SENTINELS)).not.toEqual([]);
    }
  });

  test("every_pds_route_has_a_zone", () => {
    // On what Caddy adapts, for each env's files (P1.39d): the rules on the adapted config pass. The dev rules name
    // the app and media sites' two values each and the docs site's host, so the dev config is read with those in place
    // of their sentinels.
    expect(adaptedProblems(reviewed("prod"), "shipped", SENTINELS)).toEqual([]);
    expect(adaptedProblems(reviewed("local"), "local", SENTINELS)).toEqual([]);
    const ruled = { ...DEV_APP, ...DEV_DOCS, ...DEV_MEDIA };
    const devText = (["APP_HOST", "APP_UPSTREAM", "DOCS_HOST", "MEDIA_HOST", "MEDIA_UPSTREAM"] as const).reduce(
      (text, name) => text.replaceAll(SENTINELS[name], ruled[name]),
      read("adapted/dev.generated.json"),
    );
    expect(devText).toContain(DEV_APP.APP_HOST);
    expect(adaptedProblems(JSON.parse(devText) as Json, "dev", { ...SENTINELS, ...ruled })).toEqual([]);
  });

  test("edge_admin_api_off_in_config", () => {
    for (const env of ADAPTED_ENVS) {
      expect(at(reviewed(env), "admin"), env).toEqual({ disabled: true, config: { persist: false } });
    }
    // The one trust is the dev listener's (P1.36j); adapted-rules.test.ts holds its reds.
    const trust = (env: AdaptedEnvName) =>
      objects(reviewed(env)).flatMap((each) =>
        "trusted_proxies" in each || "client_ip_headers" in each || "trusted_proxies_strict" in each
          ? [[each.listen, each.trusted_proxies, each.trusted_proxies_strict, each.client_ip_headers]]
          : [],
      );
    expect(trust("prod")).toEqual([]);
    expect(trust("local")).toEqual([]);
    expect(trust("dev")).toEqual([
      [["10.250.37.3:443"], { source: "static", ranges: ["10.250.37.2/32"] }, 1, ["X-Forwarded-For"]],
    ]);
  });

  test("edge_logs_drop_addresses_headers_and_uris", () => {
    // SE-7, on what Caddy adapts (P1.39d): the process log and every access log delete the fields that carry a client
    // address, a header, a URI or a TLS detail, and nothing else writes a log.
    const carried = ["request>client_ip", "request>headers", "request>remote_ip", "request>remote_port"];
    for (const env of ADAPTED_ENVS) {
      const logs = at(reviewed(env), "logging", "logs") as Obj;
      const sites = { prod: 1, local: 2, dev: 4 }[env];
      expect(Object.keys(logs).sort(), env).toEqual(["default", ...Array.from({ length: sites }, (_, n) => `log${n}`)]);
      for (const [name, log] of Object.entries(logs)) {
        expect(at(log, "encoder", "format"), `${env} ${name}`).toBe("filter");
        const fields = at(log, "encoder", "fields") as Obj;
        for (const field of [...carried, "request>tls", "request>uri", "resp_headers"]) {
          expect(fields[field], `${env} ${name} ${field}`).toEqual({ filter: "delete" });
        }
      }
      // The process log also drops the bare address fields Caddy's own messages use.
      const own = at(logs.default, "encoder", "fields") as Obj;
      for (const field of ["client_ip", "remote", "remote_addr", "remote_ip", "data>remote_ip"]) {
        expect(own[field], `${env} ${field}`).toEqual({ filter: "delete" });
      }
    }
  });
});

describe("PDS fonts (P2.24e)", () => {
  // The policy the P2.24d spike proved (docs/ai/notes/reference/pds-pages-fonts-come-from-edge.md): woff2 files from
  // one fixed same-origin path, and one font-src appended to the PDS's HTML CSP. Anything wider fails here.
  test("pds_fonts_match_shared_ui", () => {
    // The image's copies are byte for byte the design sheet's fonts (shared/ui/fonts), licence texts included, and the
    // Dockerfile copies each file, woff2 to the served path only.
    const shared = join(EDGE, "..", "..", "shared", "ui", "fonts");
    const names = readdirSync(join(EDGE, "fonts")).sort();
    expect(names).toEqual(readdirSync(shared).sort());
    for (const name of names) {
      expect(readFileSync(join(EDGE, "fonts", name)).equals(readFileSync(join(shared, name))), name).toBe(true);
    }
    const woff2 = names.filter((name) => name.endsWith(".woff2"));
    expect(dockerfile).toContain(
      `COPY ${woff2
        .map((name) => `fonts/${name}`)
        .sort()
        .reverse()
        .join(" ")} /etc/caddy/static/_unset/fonts/\n`,
    );
  });
});

describe("edge image", () => {
  test("edge_from_matches_lock", () => {
    expect(froms(dockerfile)).toEqual([
      `docker.io/library/caddy:${lock["caddy-builder"]?.tag}@${lock["caddy-builder"]?.digest}`,
      `docker.io/library/caddy:${lock.caddy?.tag}@${lock.caddy?.digest}`,
    ]);
    expect(lock.caddy?.tag).toMatch(/^2\.11\.9-alpine$/);
    expect(lock["caddy-builder"]?.tag).toMatch(/^2\.11\.9-builder-alpine$/);
    // The DL3026 ignore sits directly above each upstream FROM, the reason comment above it (as P1.27).
    const lines = dockerfile.split("\n");
    for (const [at, line] of lines.entries()) {
      if (!line.startsWith("FROM ")) continue;
      expect(lines[at - 1]).toBe("# hadolint ignore=DL3026");
      expect(lines[at - 2]).toMatch(/^# .*2026-10-07-p128-edge-bases-and-ratelimit-adr.*removed by P1\.27s/);
    }
  });

  test("edge_dockerfile_pins_caddy_and_plugin", () => {
    expect(pinProblems(dockerfile)).toEqual([]);
    // A fixture missing either pin, or turning the checksum database or the proxy off, fails.
    const plugin = "caddy-ratelimit@v0.1.1-0.20260612195517-5625512f24f6";
    for (const fixture of [
      dockerfile.replace("xcaddy build v2.11.9", "xcaddy build latest"),
      dockerfile.replace(plugin, "caddy-ratelimit"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=mod"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly GONOSUMDB=*"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly\nENV GOINSECURE=*"),
      dockerfile.replace("ENV GOFLAGS=-mod=readonly", "ENV GOFLAGS=-mod=readonly\nENV GONOSUMCHECK=1"),
      dockerfile.replace("--output", "-insecure --output"),
      dockerfile.replace("--output", "--with github.com/example/other \\\n      --output"),
    ]) {
      expect(pinProblems(fixture), fixture).not.toEqual([]);
    }
  });

  test("edge_final_stage_runs_are_the_ruled_three_in_order", () => {
    // Book edit 2026-10-12-edge-data-volume-owner, Amendment 3: exactly three RUNs before USER, the setcap line
    // unchanged, then the two exec-form lines final-stage-runs.json lists, in its order.
    const listed = JSON.parse(read("final-stage-runs.json")) as string[][];
    const ruled = (text: string): boolean => {
      const [setcap, ...exec] = runsBeforeUser(text);
      return (
        setcap === SETCAP_RUN &&
        exec.length === listed.length &&
        exec.every(
          (run, at) => JSON.stringify(JSON.parse(run.replace(/^\s*RUN\s+/i, ""))) === JSON.stringify(listed[at]),
        )
      );
    };
    expect(listed).toHaveLength(2);
    expect(ruled(dockerfile)).toBe(true);
    const chown = 'RUN ["/bin/chown", "-R", "65532:65532", "/data", "/config"]\n';
    const chmod = 'RUN ["/bin/chmod", "-R", "u=rwX,go=,-t", "/data", "/config"]\n';
    // The keyword is read in any case, as the run list reads it (P1.34j item 9): a listed RUN spelled `run` is the same
    // instruction to BuildKit, so it is read, not thrown on.
    expect(ruled(dockerfile.replace(chown, chown.replace(/^RUN/, "run")))).toBe(true);
    for (const fixture of [
      dockerfile.replace(chown, ""),
      dockerfile.replace(chown, "").replace(chmod, `${chmod}${chown}`),
      dockerfile.replace(chmod, `${chmod}RUN ["/bin/true"]\n`),
      dockerfile.replace("rm -rf /usr/share/caddy /etc/caddy", "rm -rf /usr/share/caddy"),
      dockerfile.replace("COPY Caddyfile", 'RUN ["/bin/true"]\nCOPY Caddyfile'),
      // Instructions are case-insensitive and any whitespace follows the keyword; an indented line is not a
      // continuation unless the line before ends in a backslash (Dockerfile reference, "Format").
      dockerfile.replace(chmod, `${chmod}run ["/bin/true"]\n`),
      dockerfile.replace(chmod, `${chmod}RUN\t["/bin/true"]\n`),
      dockerfile.replace(chmod, `${chmod}  RUN ["/bin/true"]\n`),
      // An escaped backslash ends no line (CONTINUES), so the duplicate listed RUN after it is a fourth RUN (P1.34j
      // item 8).
      dockerfile.replace(chmod, `${chmod}LABEL x=\\\\\n${chmod}`),
    ]) {
      expect(fixture).not.toBe(dockerfile);
      expect(ruled(fixture), fixture).toBe(false);
    }
  });

  test("edge_dockerfile_only_what_the_rules_read", () => {
    expect(dockerfileShapeProblems(dockerfile)).toEqual([]);
    const build = "      --output /out/caddy\n";
    const runtime = "WORKDIR /etc/caddy\n";
    const inBuild = (line: string) => dockerfile.replace(build, `${build}${line}\n`);
    const inRuntime = (line: string) => dockerfile.replace(runtime, `${runtime}${line}\n`);
    const mount = "RUN --mount=type=bind,source=local,target=/l cp -r /l /out/local";
    const laundered = "COPY --from=build /out/local/ /etc/caddy/local/";
    const ascii = "a byte outside printable ASCII and LF";
    const pinned = "a COPY --from other than the binary";
    const flag = "a COPY or ADD flag with a quote or backslash";
    const cases: [string, string][] = [
      // N-a (item 2): a builder bind mount of local/, then a copy of what it made; each half is refused alone.
      [inRuntime(laundered).replace(build, `${build}${mount}\n`), "a --mount flag"],
      [inRuntime(laundered).replace(build, `${build}${mount}\n`), pinned],
      [inBuild("run --MOUNT=type=bind,source=local,target=/l true"), "a --mount flag"],
      [inRuntime(laundered), pinned],
      [inRuntime("copy --FROM=build /out/caddy /usr/bin/caddy"), pinned],
      [dockerfile.replace(`${BINARY_COPY}\n`, ""), pinned],
      // N7 (items 4 and 5): a backslash-escaped space inside a flag word, and an empty quoted flag.
      [inRuntime("COPY --exclude=x\\ --from=build local/ /etc/caddy/local/"), flag],
      [inRuntime("COPY --exclude=x\\ --from=build local/ /etc/caddy/local/"), pinned],
      [inRuntime('COPY --"" --from=build local/ /etc/caddy/local/'), flag],
      [inRuntime("ADD --chown='0' local/ /srv/"), flag],
      // N8 (item 3): a blank BuildKit skips inside a continuation, so the COPY of local/ joins on.
      [inRuntime("COPY \\\n\v\n local/ /srv/"), ascii],
      [inRuntime("COPY \\\n\f\n local/ /srv/"), ascii],
      [inRuntime("COPY \\\n\u00a0\n local/ /srv/"), ascii],
      [inRuntime("COPY \\\n\r\r\n local/ /srv/"), ascii],
      // N9 (item 3): a separator the line regex stops at.
      [inRuntime("COPY local/\r/srv/"), ascii],
      [inRuntime("COPY local/\u2028/srv/"), ascii],
      [inRuntime("COPY local/\u2029/srv/"), ascii],
      [inRuntime("LABEL x=y\tz"), ascii],
      // Item 6: a parser directive, in any case.
      [`# syntax=docker/dockerfile:1\n${dockerfile}`, "a parser directive"],
      [`#ESCAPE=\`\n${dockerfile}`, "a parser directive"],
      // Item 7: a heredoc in RUN, COPY or ADD, also split by a continuation.
      [inBuild("RUN <<EOF\ntouch /out/x\nEOF"), "a heredoc"],
      [inRuntime("COPY <<EOF /etc/caddy/x\nEOF"), "a heredoc"],
      [inRuntime("add <<EOF /etc/caddy/x\nEOF"), "a heredoc"],
      [inBuild("RUN cat <\\\n<EOF\nx\nEOF"), "a heredoc"],
    ];
    for (const [fixture, reason] of cases) {
      expect(fixture, reason).not.toBe(dockerfile);
      expect(dockerfileShapeProblems(fixture), JSON.stringify(fixture.slice(-120))).toContain(reason);
    }
  });

  test("edge_runtime_non_root", () => {
    const runtimeOf = (text: string) => text.split(/^\s*FROM\s.*$/im).at(-1) ?? "";
    // One USER, the caddy uid, and no RUN after it, in any case and indentation Docker accepts (reference.md,
    // "Format": instructions are not case-sensitive).
    const nonRoot = (text: string): boolean => {
      const runtime = runtimeOf(text);
      const users = runtime.match(/^\s*USER\s.*$/gim) ?? [];
      const afterUser = runtime.slice(Math.max(0, runtime.search(/^\s*USER\s/im)));
      return users.join() === "USER 65532:65532" && !/^\s*RUN\s/im.test(afterUser);
    };
    expect(nonRoot(dockerfile)).toBe(true);
    for (const line of ["user 0:0", "  USER 0:0", "USER\t0", 'run ["/bin/true"]', '  RUN ["/bin/true"]']) {
      expect(nonRoot(`${dockerfile}${line}\n`), line).toBe(false);
    }
    const runtime = runtimeOf(dockerfile);
    expect(runtime).toMatch(/^RUN setcap cap_net_bind_service=\+ep \/usr\/bin\/caddy \\$/m);
    expect(runtime).toMatch(/HEALTHCHECK [\s\S]*http:\/\/127\.0\.0\.1:8081\/health/);
  });
});

describe("local stack files (P1.34c)", () => {
  // Architecture record 2026-10-12-refocus-local-signin-rulings, Amendment 1: the local stack serves both hosts with one
  // dev leaf the deploy user makes from the dev root; nothing in the stack signs. The files live in local/, which the
  // image never copies, and only the local stack mounts them (P1.34d; C18 under --env local, P1.27l).
  const local = (file: string): string =>
    read(join("local", file))
      .replaceAll(/^\s*#.*$/gm, "")
      .trim();

  test("local_tls_serves_only_the_dev_leaf", () => {
    expect(local("tls.caddy")).toBe("(tls) {\n\ttls /run/secrets/local_tls_cert /run/secrets/local_tls_key\n}");
    // As Caddy adapts the local files (P1.39d): the leaf's two files and no issuer of any kind.
    const config = JSON.parse(read("adapted/local.generated.json")) as { apps: { tls: unknown } };
    expect(config.apps.tls).toEqual({
      certificates: {
        load_files: [
          { certificate: "/run/secrets/local_tls_cert", key: "/run/secrets/local_tls_key", tags: ["cert0"] },
        ],
      },
    });
    expect(JSON.stringify(config)).not.toMatch(/"issuers"|"automation"/);
  });

  test("local_app_site_has_the_pds_sites_shared_snippets", () => {
    // TLS, the access log and the security headers as every public host has them; the zones first, then the upstream
    // snippet, which drops the client's address headers, so web sees only the edge (ADR 0018, invariant 3). Unlike the
    // PDS site it has no pds-route-class or xrpc-guard: those are the PDS's routes. A refused browser gets the
    // too-many-tries page, as on every site.
    expect(local("app.caddy")).toBe(
      [
        "{$APP_HOST} {",
        "\timport tls",
        "\timport access-log",
        "\timport security-headers",
        "\timport too-many-tries",
        "\troute {",
        "\t\timport pds-ratelimit",
        "\t\timport upstream {$APP_UPSTREAM}",
        "\t}",
        "}",
      ].join("\n"),
    );
  });

  test("local_files_never_in_the_image", () => {
    // COPY and ADD from the build context, in any case and indentation Docker accepts (moby/buildkit
    // frontend/dockerfile/docs/reference.md, "Format": instructions are not case-sensitive), read as BuildKit reads
    // them (frontend/dockerfile/parser, master): a line ending in an unescaped backslash joins the next, comment lines
    // inside dropped (parser.go:168, :329-346); only the leading `--` words are flags, and a bare `--` ends them
    // (split_command.go, extractBuilderFlags); the rest is a JSON string array when it parses as one, else words
    // (line_parsers.go, parseMaybeJSONToList). The last source word is the destination, and a copy is from a build stage
    // only when one of its flags is --from.
    const args = (rest: string): string[] => {
      try {
        const parsed: unknown = JSON.parse(rest);
        if (Array.isArray(parsed) && parsed.every((part) => typeof part === "string")) return parsed;
      } catch {
        // Not JSON: the shell form, read as words below.
      }
      return rest.split(/\s+/).filter((word) => word !== "");
    };
    const copy = (line: string): { flags: string[]; words: string[] } | undefined => {
      const [, keyword, rest = ""] = /^(\S+)\s*(.*)$/.exec(line.trim()) ?? [];
      if (!/^(COPY|ADD)$/i.test(keyword ?? "")) return undefined;
      const flags = rest.match(/^(?:--\S+(?:\s+|$))*(?:--(?:\s+|$))?/)?.[0] ?? "";
      const words = args(rest.slice(flags.length));
      return { flags: flags.split(/\s+/).filter((flag) => flag !== "" && flag !== "--"), words };
    };
    const sources = (text: string): string[] =>
      text
        .replaceAll(/(^|[^\\])\\[ \t]*\r?\n(?:[ \t]*(?:#.*)?\r?\n)*/gm, "$1")
        .split("\n")
        .flatMap((line) => copy(line) ?? [])
        .filter(({ flags }) => !flags.some((flag) => /^--from=/i.test(flag)))
        .flatMap(({ words }) => words.slice(0, -1));
    expect(sources(dockerfile)).toEqual([
      "Caddyfile",
      "snippets/",
      "sites/pds.caddy",
      "fonts/SpaceGrotesk-Variable.woff2",
      "fonts/JetBrainsMono-Variable.woff2",
      "fonts/OFL-SpaceGrotesk.txt",
      "fonts/OFL-JetBrainsMono.txt",
    ]);
    for (const line of ["copy local/ /etc/caddy/local/", "  COPY local/app.caddy /etc/caddy/", "ADD local/ /srv/"]) {
      expect(sources(`${dockerfile}${line}\n`), line).toContain(line.trim().split(/\s+/)[1]);
    }
    // Continuations are joined before the keyword is read, as BuildKit does (parser.go:168, :329-346), and a line is
    // a build-stage copy only when one of its leading flags is --from.
    for (const text of [
      "COPY \\\n    local/ /etc/caddy/local/",
      "COPY --chown=65532:65532 \\\n    local/ /srv/",
      "COPY Caddyfile \\\n    local/ /etc/caddy/",
      "CO\\\nPY local/ /srv/",
      "COPY\\\n local/ /srv/",
      "COPY \\\n# a comment\n    local/ /srv/",
      "COPY --exclude=--from=x local/ /srv/",
      // An escaped backslash ends no line (BuildKit's `([^\\])\\[ \t]*$`), so the COPY after it is its own
      // instruction; only the leading `--` words are flags (split_command.go, extractBuilderFlags), so a later
      // `--from=` word is a source; and the JSON form is read as BuildKit reads it (line_parsers.go, parseMaybeJSONToList).
      "LABEL x=\\\\\nCOPY local/ /srv/",
      "COPY local/ --from=x* /etc/caddy/local/",
      'COPY ["local/","/etc/caddy/local/"]',
      'COPY --chown=65532:65532 [ "local/", "/srv/" ]',
      "COPY -- --from=x local/ /srv/",
    ]) {
      expect(sources(`${dockerfile}${text}\n`), text).toContain("local/");
    }
    expect(readdirSync(join(EDGE, "local")).sort()).toEqual(["app.caddy", "tls.caddy"]);
  });
});

describe("dev leaf (P1.21w)", () => {
  test("dev_leaf_runbook_names_every_dev_site", () => {
    // Caddy v2.11.9 automates a certificate for every site name no loaded certificate covers
    // (modules/caddyhttp/autohttps.go:200-207, HasCertificateForSubject), so a dev site missing from the leaf the
    // runbook makes would start ACME on the staging edge, against ADR 0032 Decision 1 (Codex on #1829).
    const runbook = readFileSync(join(EDGE, "..", "..", "docs", "human", "runbooks", "dev-stack-secrets.md"), "utf8");
    const san = /subjectAltName=([^\\\n']+)\\n/.exec(runbook)?.[1];
    const names = san?.split(",").map((entry) => entry.replace(/^DNS:/, ""));
    expect(names?.sort()).toEqual(
      [DEV_APP.APP_HOST, DEV_DOCS.DOCS_HOST, DEV_MEDIA.MEDIA_HOST, "staging.unset.ac"].sort(),
    );
  });
});
