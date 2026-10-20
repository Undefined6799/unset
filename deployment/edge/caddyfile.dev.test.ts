// P1.36b: the dev edge (ADR 0031 Decisions 1 and 4, ADR 0032; book edit 2026-10-20-adr-0031-no-login). The dev stack
// serves both staging names from dev/app.caddy and dev/pds.caddy, each its own file mount (ADR 0032 Decision 3),
// https with one self-signed leaf from files (dev/tls.caddy) on the edge's newt_edge address; the app site has its
// own three zones and refuses writes to the sign-in files; both sites say noindex.
// The reader reads dev/ only in the "dev" mode, and there accepts APP_HOST and APP_UPSTREAM only as their ruled values.
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, test } from "vitest";
import {
  CaddyfileError,
  DEV_APP,
  DEV_EDGE_ADDRESS,
  DEV_TLS,
  type Directive,
  type EdgeFiles,
  edgeSiteProblems,
  readEdgeConfig,
} from "./caddyfile.ts";

const EDGE = import.meta.dirname;
const ENV = { PDS_HOST: "staging.unset.ac", PDS_UPSTREAM: "pds:3000", ACME_EMAIL: "edge@unset.test", ...DEV_APP };
const FILES: EdgeFiles = {
  list: (dir) => readdirSync(dir),
  kind: (path) => {
    const stat = lstatSync(path);
    const type = stat.isSymbolicLink() ? "link" : stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other";
    return { type, links: stat.nlink };
  },
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  read: (path) => readFileSync(path, "utf8"),
};
const read = (file: string) => readFileSync(join(EDGE, file), "utf8");

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the edge files, dev/ included, with `edits` written over them. */
function devTree(edits: Record<string, string> = {}): string {
  const edgeDir = mkdtempSync(join(tmpdir(), "edge-dev-"));
  trees.push(edgeDir);
  for (const part of ["Caddyfile", "snippets", "sites", "dev"]) {
    cpSync(join(EDGE, part), join(edgeDir, part), { recursive: true });
  }
  for (const [file, text] of Object.entries(edits)) writeFileSync(join(edgeDir, file), text);
  return edgeDir;
}
const devConfig = (edits: Record<string, string> = {}, env: Record<string, string> = ENV) => {
  const edgeDir = devTree(edits);
  return readEdgeConfig(edgeDir, devMounts(edgeDir), env, FILES, "dev");
};
/** The dev stack's two site mounts as compose.dev.yaml binds them (P1.36b). */
const devMounts = (edgeDir: string) =>
  ["app.caddy", "pds.caddy"].map((name) => ({ source: join(edgeDir, "dev", name), name }));
const devProblems = (edits: Record<string, string> = {}) => edgeSiteProblems(devConfig(edits), "dev");

const APP = read("dev/app.caddy");
const PDS = read("dev/pds.caddy");

describe("dev edge (P1.36b)", () => {
  test("dev_sites_read_clean", () => {
    // The image's loopback health site, then the two dev sites in byte order.
    const config = devConfig();
    expect(config.sites.map((site) => site.placeholders)).toEqual([[null], ["APP_HOST"], ["PDS_HOST"]]);
    expect(config.sites.map((site) => site.addresses)).toEqual([
      ["http://127.0.0.1:8081"],
      ["staging.unset.sh"],
      ["staging.unset.ac"],
    ]);
    expect(devProblems()).toEqual([]);
  });

  test("dev_sites_https_on_the_edge_address_only", () => {
    // ADR 0032 Decision 4: no :80 site, the dev (tls) alone, bound to the newt_edge address alone.
    expect(DEV_EDGE_ADDRESS).toBe("10.250.37.3");
    for (const [file, text, name] of [
      ["dev/app.caddy", APP, "{$APP_HOST}"],
      ["dev/pds.caddy", PDS, "{$PDS_HOST}"],
    ] as const) {
      const host = name.slice(2, -1);
      expect(devProblems({ [file]: text.replace(`{$${host}} {`, `http://{$${host}} {`) }), file).toEqual([
        `${name}: a plain-http dev site`,
      ]);
      // Any other scheme or a port is not a whole-word placeholder, so the reader refuses it.
      for (const address of [`https://{$${host}}`, `{$${host}}:80`]) {
        expect(() => devConfig({ [file]: text.replace(`{$${host}} {`, `${address} {`) }), address).toThrow(
          "an environment placeholder must be a whole word",
        );
      }
      const bound = `${name}: not bound to the edge's newt_edge address alone`;
      for (const bind of ["", "\tbind 0.0.0.0\n", "\tbind 10.250.37.3 10.250.37.2\n", "\tbind 10.250.37.2\n"]) {
        expect(devProblems({ [file]: text.replace("\tbind 10.250.37.3\n", bind) }), bind).toEqual([bound]);
      }
      const twice = text.replace("\tbind 10.250.37.3\n", "\tbind 10.250.37.3\n\tbind 10.250.37.3\n");
      expect(devProblems({ [file]: twice })).toEqual([bound]);
      const certificate = `${name}: a certificate other than the dev (tls)`;
      expect(devProblems({ [file]: text.replace("\timport tls\n", "") })).toEqual([
        certificate,
        `${name}: does not import tls`,
      ]);
      for (const inline of ["\ttls internal\n", "\ttls /run/secrets/dev_tls_cert /run/secrets/dev_tls_key\n"]) {
        expect(devProblems({ [file]: text.replace("\timport tls\n", `\timport tls\n${inline}`) }), inline).toEqual([
          certificate,
        ]);
      }
    }
  });

  test("dev_tls_is_the_self_signed_leaf_files", () => {
    // ADR 0032 Decision 1: dev/tls.caddy is exactly the local shape, with the dev leaf's two paths.
    const TLS = read("dev/tls.caddy");
    expect(
      devConfig()
        .snippet("tls")
        .map((d) => [d.name, ...d.args]),
    ).toEqual([["tls", ...DEV_TLS]]);
    const leaf = "the dev (tls) is not the self-signed leaf's files";
    const SITES_TWICE = ["{$APP_HOST}", "{$PDS_HOST}"].map((n) => `${n}: a certificate other than the dev (tls)`);
    for (const other of [
      "\ttls internal\n",
      "\ttls /run/secrets/dev_tls_cert\n",
      "\ttls /run/secrets/dev_tls_cert /run/secrets/dev_tls_key {\n\t\tissuer acme\n\t}\n",
      "\ttls /run/secrets/dev_tls_key /run/secrets/dev_tls_cert\n",
      "\ttls /run/secrets/dev_tls_cert /run/secrets/dev_tls_key\n\ttls internal\n",
      "\ttls {\n\t\tissuer acme {\n\t\t\tdir https://acme-v02.api.letsencrypt.org/directory\n\t\t}\n\t}\n",
    ]) {
      const edited = TLS.replace(`\ttls ${DEV_TLS.join(" ")}\n`, other);
      expect(edited, other).not.toBe(TLS);
      // Two tls lines also give each site a second certificate.
      const twice = other.split("\ttls").length > 2 ? SITES_TWICE : [];
      expect(devProblems({ "dev/tls.caddy": edited }), other).toEqual([leaf, ...twice]);
    }
    // The dev leaf's paths outside dev/ are refused in every mode; the local leaf's inside dev/ too.
    expect(() =>
      devConfig({
        "snippets/upstream.caddy": `${read("snippets/upstream.caddy")}# dev_tls_cert\n(x) {\n\ttls a dev_tls_x\n}\n`,
      }),
    ).toThrow("dev_tls_x is allowed only in dev/");
    expect(() => devConfig({ "dev/tls.caddy": TLS.replaceAll("dev_tls_", "local_tls_") })).toThrow(
      "is allowed only in local/",
    );
  });

  test("prod_refuses_a_plain_http_site", () => {
    const shipped = (site: string) => {
      const edgeDir = devTree({ "sites/pds.caddy": site });
      const enabled = join(edgeDir, "sites", "enabled");
      cpSync(join(edgeDir, "sites", "pds.caddy"), join(enabled, "pds.caddy"), { recursive: true });
      return edgeSiteProblems(readEdgeConfig(edgeDir, enabled, ENV, FILES));
    };
    expect(shipped(read("sites/pds.caddy"))).toEqual([]);
    expect(shipped(read("sites/pds.caddy").replace("{$PDS_HOST} {", "http://{$PDS_HOST} {"))).toEqual([
      "{$PDS_HOST}: a plain-http site outside dev",
    ]);
    // ADR 0032 Decision 3: prod serves no file certificate, the dev leaf's or any other.
    const site = read("sites/pds.caddy");
    for (const tls of ["\ttls /run/secrets/x_cert /run/secrets/x_key\n", "\ttls /etc/a.pem /etc/b.pem\n"]) {
      expect(shipped(site.replace("{$PDS_HOST} {\n", `{$PDS_HOST} {\n${tls}`)), tls).toEqual([
        "{$PDS_HOST}: a file certificate outside dev and local",
      ]);
    }
  });

  test("headers_and_denies_on_both_sites", () => {
    // Every header the PDS site has, and noindex, on both; the admin guard on the PDS site; the sign-in files' 405 on
    // the app site.
    const cases: [string, string, string, string][] = [
      ["dev/app.caddy", APP, "\timport security-headers\n", "{$APP_HOST}: does not import security-headers"],
      ["dev/app.caddy", APP, "\timport noindex\n", "{$APP_HOST}: does not import noindex"],
      ["dev/app.caddy", APP, "\t\timport signin-files\n", "{$APP_HOST}: does not import signin-files"],
      ["dev/pds.caddy", PDS, "\timport security-headers\n", "{$PDS_HOST}: does not import security-headers"],
      ["dev/pds.caddy", PDS, "\timport noindex\n", "{$PDS_HOST}: does not import noindex"],
      ["dev/pds.caddy", PDS, "\t\timport xrpc-guard\n", "{$PDS_HOST}: does not import xrpc-guard"],
    ];
    for (const [file, text, line, problem] of cases) {
      expect(text, line).toContain(line);
      expect(devProblems({ [file]: text.replace(line, "") }), line).toEqual([problem]);
    }
    expect(read("snippets/security-headers.caddy")).toMatch(
      /^\(noindex\) \{\n\theader X-Robots-Tag "noindex, nofollow"\n\}$/m,
    );
    const signin = devConfig().snippet("signin-files");
    expect(signin.map((d) => [d.name, ...d.args])).toEqual([
      ["@signin_files_write"],
      ["header", "@signin_files_write", "Allow", "GET, HEAD"],
      ["respond", "@signin_files_write", "405"],
    ]);
    expect(signin[0]?.block?.map((d) => [d.name, ...d.args])).toEqual([
      ["path_regexp", "(?i)^/+(?:oauth-client-metadata\\.json|oauth/+jwks\\.json)/*$"],
      ["not", "method", "GET", "HEAD"],
    ]);
  });

  test("app_site_has_its_own_zones_never_the_pds_ones", () => {
    const zones = "{$APP_HOST}: the route does not apply the zones first";
    expect(devProblems({ "dev/app.caddy": APP.replace("import app-ratelimit", "import pds-ratelimit") })).toEqual([
      zones,
    ]);
    expect(devProblems({ "dev/app.caddy": APP.replace("\t\timport app-ratelimit\n", "") })).toEqual([
      zones,
      "{$APP_HOST}: 0 rate_limit blocks",
    ]);
    const both = APP.replace("\t\timport app-ratelimit\n", "\t\timport app-ratelimit\n\t\timport pds-ratelimit\n");
    expect(devProblems({ "dev/app.caddy": both })).toEqual(["{$APP_HOST}: 2 rate_limit blocks"]);
    expect(devProblems({ "dev/pds.caddy": PDS.replace("import pds-ratelimit", "import app-ratelimit") })).toEqual([
      "{$PDS_HOST}: the route does not apply the zones first",
    ]);
    const limits = read("snippets/ratelimit.caddy");
    const narrowed = limits.replace(/(\tzone app_global \{\n)/, "$1\t\t\tmatch {\n\t\t\t\tpath /login\n\t\t\t}\n");
    expect(narrowed).not.toBe(limits);
    expect(devProblems({ "snippets/ratelimit.caddy": narrowed })).toEqual(["the app_global zone has a matcher"]);
    expect(devProblems({ "snippets/ratelimit.caddy": limits.replace("zone app_global {", "zone app_all {") })).toEqual([
      "there is no app_global zone",
    ]);
  });

  test("edge_app_zones_match_limits", () => {
    // Matcher, key and values of each app zone, pinned to limits.json (ADR 0031 Decision 1).
    const limits = JSON.parse(read("limits.json")) as { appRateLimitZones: Record<string, unknown> };
    const block = devConfig().snippet("app-ratelimit")[0]?.block ?? [];
    const value = (zone: Directive, name: string) => zone.block?.find((d) => d.name === name)?.args;
    const zones = block.filter((d) => d.name === "zone");
    expect(
      Object.fromEntries(
        zones.map((z) => [z.args[0], { events: Number(value(z, "events")?.[0]), window: value(z, "window")?.[0] }]),
      ),
    ).toEqual(limits.appRateLimitZones);
    expect(limits.appRateLimitZones).toEqual({
      app_signin: { events: 5, window: "5m" },
      app_burst: { events: 20, window: "10s" },
      app_global: { events: expect.any(Number), window: "5m" },
    });
    expect((limits.appRateLimitZones as { app_global: { events: number } }).app_global.events).toBeLessThan(1500);
    for (const zone of zones) {
      expect([value(zone, "key"), value(zone, "ipv6_prefix")], zone.args[0]).toEqual([["{remote_host}"], ["64"]]);
    }
    const matchers = (name: string) =>
      zones
        .find((z) => z.args[0] === name)
        ?.block?.filter((d) => d.name === "match")
        .map((m) => m.block?.map((d) => [d.name, ...d.args]));
    expect(matchers("app_signin")).toEqual([
      [
        ["method", "POST"],
        ["path", "/login", "/verify-email/reconsent"],
      ],
      [["path", "/oauth/callback"]],
    ]);
    expect([matchers("app_burst"), matchers("app_global")]).toEqual([[], []]);
    expect(block.some((d) => d.name === "disable_metrics")).toBe(true);
  });

  test("dev_reader_takes_only_the_ruled_app_values", () => {
    for (const [name, value] of [
      ["APP_HOST", "staging.unset.shx"],
      ["APP_HOST", "x.staging.unset.sh"],
      ["APP_HOST", "unset.sh"],
      ["APP_UPSTREAM", "web:8081"],
      ["APP_UPSTREAM", "edge:80"],
    ] as const) {
      expect(() => devConfig({}, { ...ENV, [name]: value }), value).toThrow(
        new CaddyfileError(`{$${name}} is not the dev app site's ruled value`),
      );
    }
    // The dev leaf stays local/'s alone.
    expect(() =>
      devConfig({ "dev/app.caddy": `${APP}\n# local_tls_cert\n(x) {\n\trespond local_tls_cert\n}\n` }),
    ).toThrow(/local_tls_cert is allowed only in local\//);
  });

  test("dev_sites_read_only_as_their_two_file_mounts", () => {
    const edgeDir = devTree();
    const mounts = devMounts(edgeDir);
    // Shipped (prod) takes no file mounts, and the dev mode no directory: both refused before any read.
    expect(() => readEdgeConfig(edgeDir, mounts, ENV, FILES)).toThrow(
      "site file mounts are read only in the local and dev modes",
    );
    for (const dir of [join(edgeDir, "sites"), join(edgeDir, "dev")]) {
      expect(() => readEdgeConfig(edgeDir, dir, ENV, FILES, "dev"), dir).toThrow(
        "the dev mode reads the enabled sites only as file mounts",
      );
    }
    const dev = (list: { source: string; name: string }[]) => () => readEdgeConfig(edgeDir, list, ENV, FILES, "dev");
    const [app, pds] = mounts as [(typeof mounts)[number], (typeof mounts)[number]];
    // Exactly dev/app.caddy and dev/pds.caddy, each by its own name: none missing, twice, renamed or from elsewhere.
    expect(dev([app])).toThrow("pds.caddy: not mounted");
    expect(dev([app, pds, pds])).toThrow("pds.caddy: mounted more than once");
    expect(dev([app, { ...pds, name: "x.caddy" }])).toThrow("x.caddy: not a site the dev stack mounts");
    expect(dev([app, { ...pds, source: join(edgeDir, "sites", "pds.caddy") }])).toThrow(
      "pds.caddy: not mounted from dev/pds.caddy",
    );
    expect(dev([app, { ...pds, source: join(edgeDir, "dev") }])).toThrow(
      "pds.caddy: the mount is not one regular file",
    );
    // A link in dev/ is refused, for a site and for the dev (tls).
    rmSync(pds.source);
    symlinkSync(join(edgeDir, "sites", "pds.caddy"), pds.source);
    expect(dev(mounts)).toThrow("pds.caddy: the mount is not one regular file");
    const linked = devTree();
    rmSync(join(linked, "dev", "tls.caddy"));
    symlinkSync(join(linked, "snippets", "tls.caddy"), join(linked, "dev", "tls.caddy"));
    expect(() => readEdgeConfig(linked, devMounts(linked), ENV, FILES, "dev")).toThrow("tls.caddy: not a regular file");
    // The app site's placeholders outside dev/ and local/ are refused in every mode.
    const leaked = devTree({ "sites/pds.caddy": APP });
    const enabled = join(leaked, "sites", "enabled");
    cpSync(join(leaked, "sites", "pds.caddy"), join(enabled, "app.caddy"));
    expect(() => readEdgeConfig(leaked, enabled, ENV, FILES)).toThrow(/is allowed only in local\//);
    // The local mode takes no dev/ file as a site, and no local/ file may name the dev leaf.
    const local = devTree();
    cpSync(join(EDGE, "local"), join(local, "local"), { recursive: true });
    const localMounts = (app: string) => [
      { source: join(local, "sites", "pds.caddy"), name: "pds.caddy" },
      { source: join(local, app, "app.caddy"), name: "app.caddy" },
    ];
    expect(() => readEdgeConfig(local, localMounts("dev"), ENV, FILES, "local")).toThrow(
      "app.caddy: not mounted from local/app.caddy",
    );
    writeFileSync(join(local, "local", "app.caddy"), `${read("local/app.caddy")}(x) {\n\trespond dev_tls_cert\n}\n`);
    expect(() => readEdgeConfig(local, localMounts("local"), ENV, FILES, "local")).toThrow(
      "dev_tls_cert is allowed only in dev/",
    );
  });
});

describe("dev edge denies (P1.36b; TE-6)", () => {
  /** The decoded path's spellings a client can send: letter case, runs of slashes and a trailing slash. */
  const spelled = (segments: readonly string[]) =>
    fc
      .tuple(
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: segments.length, maxLength: segments.length }),
        fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        fc.integer({ min: 0, max: 2 }),
      )
      .map(([runs, upper, trailing]) => {
        let at = 0;
        const flip = (text: string) =>
          [...text].map((ch) => ((upper[at++ % upper.length] ?? false) ? ch.toUpperCase() : ch.toLowerCase())).join("");
        return (
          segments.map((segment, i) => `${"/".repeat(runs[i] ?? 1)}${flip(segment)}`).join("") + "/".repeat(trailing)
        );
      });
  /** Percent-encodes some characters; Caddy decodes the path before path_regexp, so the decoded form is matched. */
  const decoded = (path: string) => decodeURIComponent(path);
  const encoded = (path: string, mask: boolean[]) =>
    [...path]
      .map((ch, i) => (mask[i % mask.length] && ch !== "/" ? `%${ch.charCodeAt(0).toString(16).toUpperCase()}` : ch))
      .join("");

  const regexOf = (snippet: string, matcher: string) => {
    const at = devConfig().snippet(snippet);
    const direct = at.find((d) => d.name === matcher);
    const arg = direct?.args[1] ?? direct?.block?.find((d) => d.name === "path_regexp")?.args[0] ?? "";
    // Caddy's RE2 `(?i)` as a JavaScript flag.
    return new RegExp(arg.replace(/^\(\?i\)/, ""), arg.startsWith("(?i)") ? "i" : "");
  };

  test("signin_files_405_in_every_spelling", () => {
    const files = regexOf("signin-files", "@signin_files_write");
    for (const segments of [["oauth-client-metadata.json"], ["oauth", "jwks.json"]]) {
      fc.assert(
        fc.property(spelled(segments), fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }), (path, mask) => {
          expect(files.test(decoded(encoded(path, mask))), path).toBe(true);
        }),
      );
    }
    for (const other of ["/oauth/callback", "/oauth-client-metadata.jsonx", "/x/oauth/jwks.json", "/"]) {
      expect(files.test(other), other).toBe(false);
    }
  });
});
