// P1.28h: the Caddyfile reader refuses what it does not model and expands same-file snippets the way Caddy does
// (architecture record 2026-10-07-p130s-networks-and-caddyfile-reader, point 2), and agrees with `caddy adapt` on the
// shipped config (caddyfile_reader_matches_caddy_adapt, below).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildEdgeImage, docker, EDGE, PDS_HOST } from "../../tests/integration/deployment/edge/edge-container.ts";
import { type Directive, readCaddyfile } from "./caddyfile.ts";

const ENV = { PDS_HOST: "pds.unset.test", PDS_UPSTREAM: "upstream:3000" };
const read = (text: string) => readCaddyfile(text, ENV);
const names = (directives: Directive[]) => directives.map((d) => d.name);

describe("caddyfile reader", () => {
  test("caddyfile_reader_unknown_token_fails", () => {
    for (const [text, why] of [
      ["site {\n\trespond <<EOF\n\thello\n\tEOF\n}", "heredoc not supported"],
      ['site {\n\trespond "open\n}', "unterminated quote"],
      ["site {\n\trespond 200\n", "unclosed block"],
      ["site {\n\trespond 200 }\n}", "brace inside a line"],
      ["site {\n\tbind {args[0]}\n}", "outside a snippet"],
      ["respond 200", "a top-level line must open a site block"],
      ["(s) {\n}\n(s) {\n}", "snippet s is defined twice"],
    ] as const) {
      expect(() => read(text), text).toThrow(why);
    }
  });

  // Where Caddy's lexer (v2.11.7 lexer.go next) would read a token differently from a plain word split, the reader
  // refuses instead (coordinator verification of #463, D1).
  test("caddyfile_reader_refuses_what_caddy_reads_differently", () => {
    for (const [text, why] of [
      // `\\"` in double quotes: Caddy keeps the backslashes and the quote closes the word.
      ['site {\n\theader X-A "a\\\\"\n\theader X-B "b"\n}', "backslash inside a double-quoted word"],
      ['site {\n\theader X-A "a\\"b"\n}', "backslash inside a double-quoted word"],
      // A trailing backslash continues the line in Caddy.
      ["site {\n\trespond a\\\n\t\t200\n}", "backslash before whitespace or <"],
      ["site {\n\trespond 200\\", "backslash before whitespace or <"],
      // `\#` at the start of a word is a comment in Caddy; `\<` escapes a heredoc.
      ["site {\n\trespond \\#x\n}", "backslash at the start of a word"],
      ["site {\n\trespond a\\<<EOF\n}", "backslash before whitespace or <"],
      // A quoted word ends at its quote in Caddy, and the next word starts with no space between.
      ['site {\n\trespond "a"b\n}', "quoted word followed by text"],
      ['site {\n\trespond "a\nb"\n}', "unterminated quote"],
      ["site {\n\trespond 200\u0085\n}", "unsupported character U+0085"],
      ["\ufeffsite {\n}", "unsupported character U+feff"],
      ["site {\r\n}", "unsupported character U+000d"],
      ["a.test, b.test {\n}", "a comma in a site address"],
      ["a.test,b.test {\n}", "a comma in a site address"],
    ] as const) {
      expect(() => read(text), text).toThrow(why);
    }
    // Caddy skips a comment whole, so it may hold any character (our files cite "plan §5.2").
    expect(read("# plan \u00a75.2\nsite {\n}").sites).toHaveLength(1);
    // Inside a word, `\x` stays as written, as in Caddy: the regex snippets rely on it.
    const site = read("site {\n\trespond ^/a\\.b(?:\\?[^#]*)?$\n}").sites[0];
    expect(site?.directives[0]?.args).toEqual(["^/a\\.b(?:\\?[^#]*)?$"]);
  });

  test("placeholder_unknown_name_fails", () => {
    expect(() => read("{$HOST} {\n}")).toThrow("unsupported environment placeholder {$HOST}");
    expect(() => readCaddyfile("{$ACME_EMAIL} {\n}", ENV)).toThrow("{$ACME_EMAIL} has no value");
    // A runtime placeholder only where our files use it: as the zone key, never as a directive or other argument.
    expect(() => read("site {\n\tbind {env.HOST}\n}")).toThrow("unsupported placeholder {env.HOST} in bind");
    expect(() => read("site {\n\t{http.vars.x} 200\n}")).toThrow("not allowed in site");
    expect(() => read("site {\n\tlog_append route_class {remote_host}\n}")).toThrow("unsupported placeholder");
    expect(() => read("site {\n\tmap {http.request.orig_uri} {route_class} {\n\t\t~^/a {http.vars.x}\n\t}\n}")).toThrow(
      "unsupported placeholder {http.vars.x}",
    );
  });

  test("placeholder_default_form_fails", () => {
    expect(() => read("{$PDS_HOST:fallback} {\n}")).toThrow("unsupported environment placeholder {$PDS_HOST:fallback}");
    expect(() => read("{$PDS_HOST:-x} {\n}")).toThrow("unsupported environment placeholder");
  });

  test("placeholder_value_with_syntax_fails", () => {
    const text = "{$PDS_HOST} {\n\troute {\n\t\treverse_proxy {$PDS_UPSTREAM}\n\t}\n}";
    for (const [name, value] of [
      ["PDS_UPSTREAM", "x }\nhandle {"],
      ["PDS_UPSTREAM", "upstream:3000 extra"],
      ["PDS_UPSTREAM", "upstream"],
      ["PDS_HOST", "pds.unset.test#x"],
      ["PDS_HOST", 'pds"unset.test'],
      ["PDS_HOST", "pds\\unset.test"],
    ] as const) {
      expect(() => readCaddyfile(text, { ...ENV, [name]: value }), value).toThrow(`{$${name}} has the wrong shape`);
    }
    expect(readCaddyfile(text, ENV).sites[0]?.directives[0]?.block?.[0]?.args).toEqual(["upstream:3000"]);
  });

  test("unknown_directive_fails", () => {
    expect(() => read("site {\n\tfile_server\n}")).toThrow("directive file_server is not allowed in site");
    expect(() => read("{\n\tdebug\n}\nsite {\n}")).toThrow("directive debug is not allowed in global");
    expect(() => read("site {\n\troute {\n\t\trate_limit {\n\t\t\tdistributed\n\t\t}\n\t}\n}")).toThrow(
      "directive distributed is not allowed in rate_limit",
    );
    expect(() => read("site {\n\troute {\n\t\t@m remote_ip 192.0.2.1\n\t}\n}")).toThrow("matcher remote_ip");
    expect(() => read("site {\n\tbind 127.0.0.1 {\n\t\tx\n\t}\n}")).toThrow("bind does not take a block");
  });

  test("named_route_and_invoke_refused", () => {
    expect(() => read("&(app) {\n\trespond 200\n}\nsite {\n}")).toThrow("named routes are not supported");
    expect(() => read("site {\n\tinvoke app\n}")).toThrow("directive invoke is not allowed in site");
  });

  test("quoted_directive_name_refused", () => {
    expect(() => read('(s) {\n\tbind 127.0.0.1\n}\nsite {\n\t"import" s\n}')).toThrow('quoted directive name "import"');
    expect(() => read('site {\n\t"respond" 200\n}')).toThrow('quoted directive name "respond"');
  });

  test("directive_outside_its_level_fails", () => {
    expect(() => read("site {\n\thandle {\n\t\trespond 200\n\t}\n}")).toThrow("handle is not allowed in site");
    expect(() => read("site {\n\troute {\n\t\troute {\n\t\t}\n\t}\n}")).toThrow("route is not allowed in route");
    expect(() => read("site {\n\trate_limit {\n\t}\n}")).toThrow("rate_limit is not allowed in site");
    expect(() => read("site {\n\t@m path /a\n}")).toThrow("@m is not allowed in site");
    expect(() => read("{\n\troute {\n\t}\n}\nsite {\n}")).toThrow("route is not allowed in global");
  });

  test("caddyfile_reader_resolves_snippet_imports", () => {
    const config = read(
      [
        "{",
        "\tadmin off",
        "}",
        "(proxy) {",
        "\treverse_proxy {args[0]} {",
        "\t\theader_up -Forwarded",
        "\t}",
        "}",
        "(guard) {",
        "\t@admin path /admin/*",
        "\trespond @admin 404",
        "\timport proxy {$PDS_UPSTREAM}",
        "}",
        "# a comment line",
        '{$PDS_HOST} "second name" {',
        "\troute {",
        "\t\timport guard",
        "\t}",
        "}",
      ].join("\n"),
    );
    expect(names(config.global ?? [])).toEqual(["admin"]);
    expect(config.sites.map((site) => site.addresses)).toEqual([["pds.unset.test", "second name"]]);
    const route = config.sites[0]?.directives[0];
    expect(route?.name).toBe("route");
    // A nested import keeps the outermost snippet's name, and its argument is in place.
    expect(route?.block?.map((d) => [d.name, d.args, d.via])).toEqual([
      ["@admin", ["path", "/admin/*"], "guard"],
      ["respond", ["@admin", "404"], "guard"],
      ["reverse_proxy", ["upstream:3000"], "guard"],
    ]);
    expect(route?.block?.[2]?.block?.map((d) => [d.name, d.args])).toEqual([["header_up", ["-Forwarded"]]]);
    expect(names(config.snippet("proxy", ["x:1"]))).toEqual(["reverse_proxy"]);
    // An import before its snippet, a missing argument, and a snippet importing itself all fail.
    expect(() => read("site {\n\timport later\n}\n(later) {\n}")).toThrow("not a snippet defined above");
    expect(() => read("(p) {\n\treverse_proxy {args[1]}\n}\nsite {\n\timport p a\n}")).toThrow("has no value");
    expect(() => read("(loop) {\n\timport loop\n}\nsite {\n\timport loop\n}")).toThrow("too many imports");
  });

  test("caddyfile_reader_refuses_file_imports", () => {
    for (const target of ["snippets/*.caddy", "sites/enabled/*.caddy", "other.caddy", "missing", '"proxy"']) {
      expect(() => read(`(proxy) {\n}\nsite {\n\timport ${target}\n}`), target).toThrow(
        "is not a snippet defined above (file imports are refused)",
      );
      expect(() => read(`import ${target}\nsite {\n}`), target).toThrow("file imports are refused");
    }
    expect(() => read("site {\n\timport\n}")).toThrow("import without a target");
  });
});

// The reader against Caddy itself: the shipped Caddyfile, with the PDS site enabled as P1.29 and P5 mount it, adapted
// by the built edge image (`caddy adapt`, Caddy v2.11.7). CI only, like the edge integration tests that build the same
// image; `npm test` locally skips it unless CI is set.
describe("caddyfile reader against caddy adapt", () => {
  const env = { PDS_HOST, PDS_UPSTREAM: "upstream:3000", ACME_EMAIL: "edge@unset.test" };

  test.runIf(process.env.CI)(
    "caddyfile_reader_matches_caddy_adapt",
    () => {
      const theirs = adapt(buildEdgeImage(), env);
      const ours = readCaddyfile(shippedConfig(), env);
      expect(ours.sites.flatMap((site) => site.addresses.map(hostOf)).sort()).toEqual(adaptedHosts(theirs).sort());
      const route = ours.sites
        .find((site) => site.addresses.includes(PDS_HOST))
        ?.directives.find((directive) => directive.name === "route");
      const handlers = (route?.block ?? [])
        .filter((d) => !d.name.startsWith("@"))
        .map((d) => HANDLER[d.name] ?? d.name);
      const pdsRoute = adaptedPdsRoute(theirs);
      expect(handlers).toEqual(pdsRoute.flatMap((r) => r.handle.map((h) => h.handler)));
      expect(route?.block?.map((d) => d.via)).toEqual(["pds-ratelimit", ...Array(6).fill("xrpc-guard"), "upstream"]);
      const zones = route?.block?.find((d) => d.name === "rate_limit")?.block?.filter((d) => d.name === "zone") ?? [];
      const limits = pdsRoute.flatMap((r) => r.handle).find((h) => h.handler === "rate_limit")?.rate_limits ?? {};
      expect(zones.map((zone) => zone.args[0]).sort()).toEqual(Object.keys(limits).sort());
      for (const zone of zones) {
        const value = (name: string) => zone.block?.find((d) => d.name === name)?.args[0] ?? "";
        const name = zone.args[0] ?? "";
        expect(
          {
            key: KEY[value("key")] ?? value("key"),
            ipv6_prefix: Number(value("ipv6_prefix")),
            max_events: Number(value("events")),
            window: nanoseconds(value("window")),
            matched: zone.block?.some((d) => d.name === "match") ?? false,
          },
          name,
        ).toEqual({ ...pick(limits[name]), matched: limits[name]?.match !== undefined });
      }
    },
    600_000,
  );
});

type AdaptedHandler = { handler: string; routes?: AdaptedRoute[]; rate_limits?: Record<string, AdaptedZone> };
type AdaptedRoute = { match?: { host?: string[] }[]; handle: AdaptedHandler[] };
type AdaptedZone = { key: string; ipv6_prefix: number; max_events: number; window: number; match?: unknown };
type Adapted = { apps: { http: { servers: Record<string, { routes: AdaptedRoute[] }> } } };

/** The Caddyfile directive each adapted handler comes from, where the names differ. */
const HANDLER: Record<string, string> = { respond: "static_response" };
/** Caddyfile placeholder shorthands the zones use, in their adapted long form (Caddy v2.11.7 caddyfile/parse.go). */
const KEY: Record<string, string> = { "{remote_host}": "{http.request.remote.host}" };

const pick = (zone: AdaptedZone | undefined) => ({
  key: zone?.key,
  ipv6_prefix: zone?.ipv6_prefix,
  max_events: zone?.max_events,
  window: zone?.window,
});
const hostOf = (address: string): string => address.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
const nanoseconds = (duration: string): number => {
  const [, amount = "", unit = ""] = /^(\d+)([smh])$/.exec(duration) ?? [];
  return Number(amount) * { s: 1, m: 60, h: 3600 }[unit as "s" | "m" | "h"] * 1e9;
};

/** The shipped Caddyfile with its two file imports resolved as Caddy would (sorted globs), the PDS site enabled. */
function shippedConfig(): string {
  const caddyfile = readFileSync(join(EDGE, "Caddyfile"), "utf8");
  const snippets = readdirSync(join(EDGE, "snippets"))
    .sort()
    .map((file) => readFileSync(join(EDGE, "snippets", file), "utf8"))
    .join("\n");
  const imports = [...caddyfile.matchAll(/^import (\S+)$/gm)].map((match) => match[1]);
  expect(imports).toEqual(["snippets/*.caddy", "sites/enabled/*.caddy"]);
  return caddyfile
    .replace("import snippets/*.caddy", snippets)
    .replace("import sites/enabled/*.caddy", readFileSync(join(EDGE, "sites", "pds.caddy"), "utf8"));
}

function adapt(image: string, env: Record<string, string>): Adapted {
  const result = docker([
    "run",
    "--rm",
    "--read-only",
    "--entrypoint",
    "caddy",
    ...Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
    "-v",
    `${join(EDGE, "sites", "pds.caddy")}:/etc/caddy/sites/enabled/pds.caddy:ro`,
    image,
    "adapt",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]);
  if (result.code !== 0) throw new Error(`caddy adapt failed: ${result.err.slice(-2000)}`);
  return JSON.parse(result.out) as Adapted;
}

const adaptedHosts = (adapted: Adapted): string[] =>
  Object.values(adapted.apps.http.servers).flatMap((server) => server.routes.flatMap((r) => r.match?.[0]?.host ?? []));

/** The routes of the PDS site's `route` block: the site's subroute handler that holds the rate limiter. */
function adaptedPdsRoute(adapted: Adapted): AdaptedRoute[] {
  const site = Object.values(adapted.apps.http.servers)
    .flatMap((server) => server.routes)
    .find((r) => r.match?.[0]?.host?.includes(PDS_HOST));
  const handlers = (site?.handle[0]?.routes ?? []).flatMap((r) => r.handle);
  const block = handlers.find((h) => h.routes?.some((r) => r.handle.some((x) => x.handler === "rate_limit")));
  return block?.routes ?? [];
}
