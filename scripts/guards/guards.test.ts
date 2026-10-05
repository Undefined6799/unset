// Each guard against planted fixtures (fixtures/<rule>/{bad,good}/*.fixture). The first line of a fixture names the
// path it is copied to and the number of findings expected there; the .fixture suffix keeps it out of the real scan.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import * as compositionRoot from "./composition-root.ts";
import * as cookieDomain from "./cookie-domain.ts";
import * as egress from "./egress.ts";
import type { Finding } from "./files.ts";
import * as innerHtml from "./inner-html.ts";
import * as ipColumns from "./ip-columns.ts";
import * as routeRegistration from "./route-registration.ts";
import * as webNoModerator from "./web-no-moderator.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const HEADER = /^(?:\/\/|--)\s*fixture:\s*(\S+)\s+findings=(\d+)\s*$/;
const SCANNERS: Record<string, (root: string) => Finding[]> = {
  egress: egress.scanAll,
  "cookie-domain": cookieDomain.scanAll,
  "inner-html": innerHtml.scanAll,
  "web-no-moderator": webNoModerator.scanAll,
  "ip-columns": (root) => ipColumns.scanAll(root, []),
  "route-registration": routeRegistration.scanAll,
  "composition-root": compositionRoot.scanAll,
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempRepo(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "guards-"));
  temps.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

/** Copies the named fixtures into one temp repo, scans it, and returns expected and actual findings per path. */
function runFixtures(rule: string, kind: "bad" | "good", names?: string[]) {
  const dir = join(FIXTURES, rule, kind);
  const files: Record<string, string> = {};
  const expected: Record<string, number> = {};
  for (const name of names ?? readdirSync(dir)) {
    const text = readFileSync(join(dir, name), "utf8");
    const [, path = "", count = "-1"] = HEADER.exec(text.split("\n")[0] ?? "") ?? [];
    expect(path, `${rule}/${kind}/${name} header`).not.toBe("");
    files[path] = text;
    expected[path] = Number(count);
  }
  expect(Object.keys(expected).length, `${rule}/${kind} has fixtures with distinct paths`).toBe(
    (names ?? readdirSync(dir)).length,
  );
  expect(Object.keys(expected).length).toBeGreaterThan(0);
  const actual: Record<string, number> = Object.fromEntries(Object.keys(files).map((p) => [p, 0]));
  for (const f of SCANNERS[rule]?.(tempRepo(files)) ?? []) actual[f.file] = (actual[f.file] ?? 0) + 1;
  return { expected, actual };
}

function expectFixtures(rule: string, kind: "bad" | "good", names?: string[]): void {
  const { expected, actual } = runFixtures(rule, kind, names);
  expect(actual).toEqual(expected);
  if (kind === "bad") expect(Object.values(actual).every((n) => n > 0)).toBe(true);
}

describe("egress", () => {
  test("egress_bad_fixture", () => expectFixtures("egress", "bad", ["dynamic-fetch.fixture"]));
  test("egress_bad_fixture_raw_sockets", () => expectFixtures("egress", "bad", ["raw-sockets.fixture"]));
  test("egress_good_fixture", () => expectFixtures("egress", "good"));
  test("egress_fetch_split_over_lines_and_bare_allow", () => expectFixtures("egress", "bad", ["split-fetch.fixture"]));

  test("egress_allow_needs_reason", () => {
    expect(egress.scanEgress("apps/web/a.ts", "fetch(u) // guard-allow: egress")).toHaveLength(1);
    expect(egress.scanEgress("apps/web/a.ts", "fetch(u) // guard-allow: egress constant PDS URL")).toHaveLength(0);
  });

  test("egress_file_exemption_exact", () => {
    expect(egress.EGRESS_FILE_EXEMPTIONS).toEqual(["interfaces/pds-admin/pds.mjs"]);
    const line = 'import http from "node:http";';
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/pds.mjs": line }))).toEqual([]);
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/other.mjs": line }))).toHaveLength(1);
  });
});

describe("cookie-domain", () => {
  test("cookie_bad_fixture", () => expectFixtures("cookie-domain", "bad"));
  test("cookie_good_fixture", () => expectFixtures("cookie-domain", "good"));
});

describe("inner-html", () => {
  test("inner_html_bad_fixture", () => expectFixtures("inner-html", "bad"));
  test("inner_html_good_fixture", () => expectFixtures("inner-html", "good"));

  test("inner_html_exemption_list_empty", () => {
    const lists = Object.entries(innerHtml).filter(([name]) => /exempt|allow/i.test(name));
    for (const [, value] of lists) expect(value).toEqual([]);
    expect(innerHtml.scanInnerHtml("apps/web/a.ts", "el.innerHTML = s; // guard-allow: inner-html why")).toHaveLength(
      1,
    );
  });
});

describe("web-no-moderator", () => {
  test("web_moderator_bad_fixture", () => expectFixtures("web-no-moderator", "bad", ["routes.fixture"]));
  test("web_moderator_good_fixture", () => expectFixtures("web-no-moderator", "good"));
  test("web_moderator_preserve_verb", () => expectFixtures("web-no-moderator", "bad", ["preserve.fixture"]));
  test("web_moderator_relative_admin_import", () =>
    expectFixtures("web-no-moderator", "bad", ["relative-admin.fixture"]));
});

describe("ip-columns", () => {
  test("ip_columns_bad_fixture", () => expectFixtures("ip-columns", "bad"));
  test("ip_columns_good_fixture", () => expectFixtures("ip-columns", "good"));

  test("ip_columns_allow_file", () => {
    const migration = "CREATE TABLE app.t (\n  id bigint,\n  client_ip text\n);\n";
    const root = tempRepo({ "infrastructure/postgres/migrations/0001.sql": migration });
    const entry = { table: "app.t", step: "P4.03", reason: "sealed transmission buffer (decision 21)" };
    expect(ipColumns.scanAll(root, [entry])).toEqual([]);
    // An unexplained entry is a finding and exempts nothing, so its column is flagged too.
    expect(ipColumns.scanAll(root, [{ ...entry, reason: " " }])).toHaveLength(2);
    expect(ipColumns.scanAll(root, [{ ...entry, step: "later" }])).toHaveLength(1);
    expect(ipColumns.scanAll(root, [entry, { ...entry, table: "app.nowhere" }])).toHaveLength(1);
  });

  test("ip_columns_allow_file_unparsable_is_finding", () => {
    const root = tempRepo({ [ipColumns.ALLOW_FILE]: "{ not json" });
    expect(ipColumns.scanAll(root)).toHaveLength(1);
  });

  test("ip_columns_allow_starts_empty", () => {
    const text = readFileSync(join(import.meta.dirname, "ip-columns.allow.json"), "utf8");
    expect(JSON.parse(text)).toEqual([]);
  });
});

describe("route-registration", () => {
  test("route_registration_guard", () => expectFixtures("route-registration", "bad", ["app-post.fixture"]));
  test("route_registration_own_hono", () => expectFixtures("route-registration", "bad", ["own-hono.fixture"]));
  test("route_registration_good_fixture", () => expectFixtures("route-registration", "good"));

  test("route_registration_exemptions_exact", () => {
    expect(routeRegistration.KIT_FILES).toEqual(["shared/http/server.ts", "shared/http/routes.ts"]);
  });
});

describe("composition-root", () => {
  test("composition_root_split", () => expectFixtures("composition-root", "bad", ["infra-import.fixture"]));
  test("composition_root_good_fixture", () => expectFixtures("composition-root", "good"));

  test("composition_root_needs_one_compose_import", () => {
    const compose = "export async function compose() {}";
    const none = tempRepo({ "interfaces/api/main.ts": "start();", "interfaces/api/compose.ts": compose });
    expect(compositionRoot.scanAll(none).map((f) => f.text)).toEqual(["no import of ./compose.ts"]);
    const twice = 'import { compose } from "./compose.ts";\nconst again = await import("./compose.ts");';
    const two = tempRepo({ "interfaces/api/main.ts": twice, "interfaces/api/compose.ts": compose });
    expect(compositionRoot.scanAll(two)).toEqual([
      {
        file: "interfaces/api/main.ts",
        line: 2,
        rule: "composition-root",
        text: 'const again = await import("./compose.ts");',
      },
    ]);
  });

  test("composition_root_only_entrypoint_main", () => {
    const infra = 'import { x } from "../../../infrastructure/postgres/x.ts";';
    expect(compositionRoot.scanAll(tempRepo({ "interfaces/http/routes/main.ts": infra }))).toEqual([]);
    expect(compositionRoot.scanAll(tempRepo({ "interfaces/http/compose.ts": infra }))).toEqual([]);
  });
});
