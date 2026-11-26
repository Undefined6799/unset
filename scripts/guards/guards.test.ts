// Each guard against planted fixtures (fixtures/<rule>/{bad,good}/*.fixture). The first line of a fixture names the
// path it is copied to and the number of findings expected there; the .fixture suffix keeps it out of the real scan.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import * as alsoKnownAs from "./also-known-as.ts";
import * as caseCollision from "./case-collision.ts";
import * as classColours from "./class-colours.ts";
import * as compositionRoot from "./composition-root.ts";
import * as conflictMarkers from "./conflict-markers.ts";
import * as cookieDomain from "./cookie-domain.ts";
import * as cssLayers from "./css-layers.ts";
import * as egress from "./egress.ts";
import type { Finding } from "./files.ts";
import { fixtureGitEnv } from "./git-env.ts";
import * as innerHtml from "./inner-html.ts";
import * as ipColumns from "./ip-columns.ts";
import * as pageClasses from "./page-classes.ts";
import * as routeRegistration from "./route-registration.ts";
import * as svelteImports from "./svelte-imports.ts";
import * as webNoModerator from "./web-no-moderator.ts";
import * as webPrerender from "./web-prerender.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const HEADER = /^(?:\/\/|--|\/\*)\s*fixture:\s*(\S+)\s+findings=(\d+)\s*(?:\*\/)?\s*$/;
const SCANNERS: Record<string, (root: string) => Finding[]> = {
  egress: egress.scanAll,
  "cookie-domain": cookieDomain.scanAll,
  "inner-html": innerHtml.scanAll,
  "css-layers": cssLayers.scanAll,
  "web-no-moderator": webNoModerator.scanAll,
  "svelte-imports": svelteImports.scanAll,
  "web-prerender": webPrerender.scanAll,
  "ip-columns": (root) => ipColumns.scanAll(root, []),
  "route-registration": routeRegistration.scanAll,
  "composition-root": compositionRoot.scanAll,
  "also-known-as": alsoKnownAs.scanAll,
  "page-classes": pageClasses.scanAll,
  "class-colours": classColours.scanAll,
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

/** Reads the named fixtures: their contents by target path, and the findings expected at each path. */
function readFixtures(rule: string, kind: "bad" | "good", names?: string[]) {
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
  return { files, expected };
}

/** Counts findings per path, starting every expected path at zero. */
function countFindings(paths: string[], findings: Finding[]): Record<string, number> {
  const actual: Record<string, number> = Object.fromEntries(paths.map((p) => [p, 0]));
  for (const f of findings) actual[f.file] = (actual[f.file] ?? 0) + 1;
  return actual;
}

/** Copies the named fixtures into one temp repo, scans it, and returns expected and actual findings per path. */
function runFixtures(rule: string, kind: "bad" | "good", names?: string[]) {
  const { files, expected } = readFixtures(rule, kind, names);
  return { expected, actual: countFindings(Object.keys(files), SCANNERS[rule]?.(tempRepo(files)) ?? []) };
}

function expectFixtures(rule: string, kind: "bad" | "good", names?: string[]): void {
  const { expected, actual } = runFixtures(rule, kind, names);
  expect(actual).toEqual(expected);
  if (kind === "bad") expect(Object.values(actual).every((n) => n > 0)).toBe(true);
}

describe("egress", () => {
  test("egress_bad_fixture", () => expectFixtures("egress", "bad", ["dynamic-fetch.fixture"]));
  test("egress_bad_fixture_raw_sockets", () => expectFixtures("egress", "bad", ["raw-sockets.fixture"]));
  test("egress_reads_svelte_files", () => expectFixtures("egress", "bad", ["svelte.fixture"]));
  test("egress_good_fixture", () => expectFixtures("egress", "good"));
  test("egress_fetch_split_over_lines_and_bare_allow", () => expectFixtures("egress", "bad", ["split-fetch.fixture"]));

  test("egress_allow_needs_reason", () => {
    expect(egress.scanEgress("apps/web/a.ts", "fetch(u) // guard-allow: egress")).toHaveLength(1);
    expect(egress.scanEgress("apps/web/a.ts", "fetch(u) // guard-allow: egress constant PDS URL")).toHaveLength(0);
  });

  test("egress_file_exemption_exact", () => {
    // guard.pds_admin_single_file (P2.09): pds-admin's one egress file, and no other file in that folder; chat-admin's
    // likewise (ADR 0093 Compliance).
    expect(egress.EGRESS_FILE_EXEMPTIONS).toEqual(["interfaces/pds-admin/pds.ts", "interfaces/chat-admin/outbound.ts"]);
    const line = 'import http from "node:http";';
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/pds.ts": line }))).toEqual([]);
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/other.ts": line }))).toHaveLength(1);
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/pds.mjs": line }))).toHaveLength(1);
    expect(egress.scanAll(tempRepo({ "interfaces/pds-admin/issue.ts": "await fetch(url);" }))).toHaveLength(1);
    expect(egress.scanAll(tempRepo({ "interfaces/chat-admin/outbound.ts": line }))).toEqual([]);
    expect(egress.scanAll(tempRepo({ "interfaces/chat-admin/commands.ts": line }))).toHaveLength(1);
    expect(egress.scanAll(tempRepo({ "interfaces/chat-admin/mas.ts": line }))).toHaveLength(1);
  });
});

describe("cookie-domain", () => {
  test("cookie_bad_fixture", () => expectFixtures("cookie-domain", "bad"));
  test("cookie_good_fixture", () => expectFixtures("cookie-domain", "good"));
});

describe("css-layers", () => {
  // Each bad fixture is scanned beside the good layers.css and tokens.css, so it fails for its own reason only.
  const base = () => readFixtures("css-layers", "good", ["layers.fixture", "tokens.fixture"]).files;
  const expectBad = (name: string): void => {
    const { files, expected } = readFixtures("css-layers", "bad", [name]);
    const findings = cssLayers.scanAll(tempRepo({ ...base(), ...files }));
    expect(countFindings(Object.keys(files), findings)).toEqual(expected);
  };
  test("css_layers_good_fixture", () => expectFixtures("css-layers", "good"));
  test("css_layers_planted_unlayered_rule", () => expectBad("unlayered.fixture"));
  test("css_layers_wrong_layer", () => expectBad("wrong-layer.fixture"));
  test("css_layers_rule_after_the_layer", () => expectBad("second-block.fixture"));
  test("css_layers_unplanned_file", () => expectBad("stray-file.fixture"));
  test("css_layers_unknown_var", () => expectBad("unknown-var.fixture"));

  test("css_layers_reads_names_from_layers_css", () => {
    expect(cssLayers.declaredLayers("/* order */\n@layer tokens, base;\n")).toEqual(["tokens", "base"]);
    expect(cssLayers.declaredLayers("@layer tokens;\n.a {\n}\n")).toBeUndefined();
    const { files } = readFixtures("css-layers", "good", ["screen.fixture"]);
    const findings = cssLayers.scanAll(
      tempRepo({ ...base(), ...files, [cssLayers.LAYERS_FILE]: "@layer tokens, base, components;\n" }),
    );
    expect(findings.map((f) => f.text)).toEqual([`layer screens is not declared in ${cssLayers.LAYERS_FILE}`]);
  });

  test("css_layers_owner_editor_is_a_screen", () => {
    // The owner's README editor (ADR 0037 point 5) styles a page of its own, so its CSS sits in the screens layer.
    expect(cssLayers.layerFor("apps/web/src/editor/ReadmeEditor.module.css")).toBe("screens");
    expect(cssLayers.layerFor("apps/web/src/editor/nested/A.module.css")).toBe("screens");
    expect(cssLayers.layerFor("apps/web/src/editor/a.css")).toBeUndefined();
    expect(cssLayers.layerFor("apps/admin/src/editor/A.module.css")).toBeUndefined();
  });

  test("css_layers_unbalanced_fails_closed", () => {
    const ctx = { layers: ["screens"], tokens: new Set<string>(), themeVars: new Set<string>() };
    expect(cssLayers.scanCss("apps/web/screens/A.module.css", "@layer screens {\n.a {\n", ctx)).toHaveLength(1);
    expect(cssLayers.scanCss("apps/web/screens/A.module.css", "@layer screens {}\n.a", ctx)).toHaveLength(1);
  });

  // ADR 0055: the theme file is plain and unlayered so the PDS screens can append it, and the Tailwind entry reads
  // only its variables.
  const ctx = { layers: ["tokens"], tokens: new Set(["--color-ink"]), themeVars: new Set(["--background"]) };
  const theme = (css: string) => cssLayers.scanCss(cssLayers.THEME_FILE, css, ctx).map((f) => f.text);

  test("css_layers_theme_file_holds_only_its_root_blocks", () => {
    const good =
      ':root {\n  color-scheme: light dark;\n  --background: light-dark(#fff, #000);\n}\n:root[data-theme="dark"] {\n  color-scheme: dark;\n}\n';
    expect(theme(good)).toEqual([]);
    expect(theme(":root {\n  --a: 1;\n}\nbody {\n  --a: 2;\n}\n")).toEqual([
      "theme file holds only its :root blocks: body",
    ]);
    expect(theme(":root {\n  color: red;\n}\n")).toEqual([
      "theme file declares only variables and color-scheme: color",
    ]);
    expect(theme('@import "x.css";\n')).toContain("theme file loads nothing: no @import or url()");
    expect(theme(":root {\n  --f: url(/a.woff2);\n}\n")).toEqual(["theme file loads nothing: no @import or url()"]);
    expect(theme("@layer base {\n  :root {\n    --a: 1;\n  }\n}\n")).toEqual([
      "theme file holds only its :root blocks: @layer base",
    ]);
  });

  test("css_layers_tailwind_entry_reads_theme_variables_only", () => {
    const entry = (css: string) => cssLayers.scanCss(cssLayers.TAILWIND_FILE, css, ctx).map((f) => f.text);
    expect(entry('@import "tailwindcss";\n@theme inline {\n  --color-background: var(--background);\n}\n')).toEqual([]);
    expect(entry("@theme inline {\n  --color-ink: var(--color-ink);\n  --x: var(--y);\n}\n")).toEqual([
      "--y is not a token or declared in this file",
    ]);
    expect(cssLayers.layerFor("apps/web/other.css")).toBeUndefined();
    // The chat page's entry (ADR 0099) is a Tailwind entry too, held to the same theme variables.
    expect(cssLayers.layerFor("apps/chat/app.css")).toBe("tailwind-entry");
    const chat = cssLayers
      .scanCss("apps/chat/app.css", "@theme inline {\n  --x: var(--y);\n}\n", ctx)
      .map((f) => f.text);
    expect(chat).toEqual(["--y is not a token or declared in this file"]);
  });
});

describe("page-classes", () => {
  test("page_classes_bad_fixture", () => expectFixtures("page-classes", "bad"));
  test("page_classes_good_fixture", () => expectFixtures("page-classes", "good"));
});

describe("class-colours", () => {
  test("class_colours_bad_fixture", () => expectFixtures("class-colours", "bad"));
  test("class_colours_good_fixture", () => expectFixtures("class-colours", "good"));
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

describe("web-prerender", () => {
  test("web_prerender_page_export", () => expectFixtures("web-prerender", "bad", ["page.fixture"]));
  test("web_prerender_config_entry", () => expectFixtures("web-prerender", "bad", ["config.fixture"]));
  test("web_prerender_proof_route", () => expectFixtures("web-prerender", "bad", ["proof.fixture"]));
  test("web_prerender_good_fixture", () => expectFixtures("web-prerender", "good"));
});

describe("svelte-imports", () => {
  test("svelte_type_import_of_core_fails", () => expectFixtures("svelte-imports", "bad", ["type-domain.fixture"]));
  test("svelte_app_names_no_interface", () => expectFixtures("svelte-imports", "bad", ["app-interface.fixture"]));
  test("svelte_imports_good_fixture", () => expectFixtures("svelte-imports", "good"));
  test("svelte_imports_scans_components", () => {
    // AB-4: an empty scan would pass vacuously; apps/web and interfaces/web hold components from P1.20a.
    expect(svelteImports.scannedFiles(join(import.meta.dirname, "..", "..")).length).toBeGreaterThan(0);
  });
});

describe("web-no-moderator", () => {
  test("web_moderator_bad_fixture", () => expectFixtures("web-no-moderator", "bad", ["routes.fixture"]));
  test("web_moderator_good_fixture", () => expectFixtures("web-no-moderator", "good"));
  test("web_moderator_preserve_verb", () => expectFixtures("web-no-moderator", "bad", ["preserve.fixture"]));
  test("web_moderator_reads_svelte_files", () => expectFixtures("web-no-moderator", "bad", ["svelte.fixture"]));
  test("web_moderator_relative_admin_import", () =>
    expectFixtures("web-no-moderator", "bad", ["relative-admin.fixture"]));
});

describe("also-known-as", () => {
  test("also_known_as_bad_fixture", () => expectFixtures("also-known-as", "bad"));
  test("also_known_as_good_fixture", () => expectFixtures("also-known-as", "good"));

  test("also_known_as_no_guard_allow", () => {
    const line = "const h = doc.alsoKnownAs; // guard-allow: also-known-as display only";
    expect(alsoKnownAs.scanAlsoKnownAs("apps/web/a.ts", line)).toHaveLength(1);
  });

  test("also_known_as_allowlist_exact", () => {
    // A file beside an allowed one, or the same name in another folder, is not allowed.
    const line = "doc.alsoKnownAs";
    expect(alsoKnownAs.scanAll(tempRepo({ "domains/identity/did-doc.ts": line }))).toEqual([]);
    expect(alsoKnownAs.scanAll(tempRepo({ "domains/moderation/did-doc.ts": line }))).toHaveLength(1);
    expect(alsoKnownAs.scanAll(tempRepo({ "domains/identity/did-doc.ts.bak.ts": line }))).toHaveLength(1);
  });
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
  test("route_registration_old_kit_path_is_not_exempt", () =>
    expectFixtures("route-registration", "bad", ["old-kit-path.fixture"]));
  test("route_registration_good_fixture", () => expectFixtures("route-registration", "good"));
});

describe("composition-root", () => {
  test("composition_root_split", () => expectFixtures("composition-root", "bad", ["infra-import.fixture"]));
  test("composition_root_compose_present", () => expectFixtures("composition-root", "bad", ["no-compose.fixture"]));
  test("composition_root_good_fixture", () => expectFixtures("composition-root", "good"));
  test("composition_root_kit_hooks", () => expectFixtures("composition-root", "bad", ["kit-hooks.fixture"]));
  test("composition_root_kit_server", () => expectFixtures("composition-root", "bad", ["kit-server.fixture"]));
  test("composition_root_empty_tree_passes", () => {
    expect(compositionRoot.scanAll(tempRepo({ "shared/x/index.ts": "export {};" }))).toEqual([]);
    expect(compositionRoot.scanAll(join(import.meta.dirname, "..", ".."))).toEqual([]);
  });

  test("composition_root_examines_the_web_entries", () => {
    // AB-4: after the SvelteKit move the guard matched no file (P1.20k); the web's two entry files must be scanned.
    expect(compositionRoot.entryFiles(join(import.meta.dirname, "..", ".."))).toEqual(
      expect.arrayContaining(["interfaces/web/server.ts", "interfaces/web/src/hooks.server.ts"]),
    );
  });

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

/**
 * A git repository whose index lists `paths` (each an empty blob) without writing them to disk: on a case-insensitive
 * file system `Foo.ts` written after `foo.ts` would overwrite it, and the pair could never be staged.
 */
function indexedRepo(paths: string[]): string {
  const root = tempRepo({});
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", root, ...args], { env: fixtureGitEnv(), encoding: "utf8", input }).trim();
  git(["init", "-q"]);
  const blob = git(["hash-object", "-w", "--stdin"], "");
  git(["update-index", "-z", "--index-info"], paths.map((p) => `100644 ${blob}\t${p}\0`).join(""));
  return root;
}

function expectCaseFixtures(kind: "bad" | "good", names?: string[]): void {
  const { files, expected } = readFixtures("case-collision", kind, names);
  const paths = Object.keys(files);
  expect(countFindings(paths, caseCollision.scanAll(indexedRepo(paths)))).toEqual(expected);
}

const flagged = (paths: string[]) => caseCollision.scanAll(indexedRepo(paths)).map((f) => f.file);

describe("case-collision", () => {
  test("case_pair_file_fails", () => expectCaseFixtures("bad", ["file-lower.fixture", "file-upper.fixture"]));
  test("distinct_names_pass", () => expectCaseFixtures("good"));
  test("case_pair_dir_fails", () => expect(flagged(["a/x.ts", "A/x.ts"])).toEqual(["A", "a"]));
  test("case_pair_dir_different_files_fails", () => expect(flagged(["a/x.ts", "A/y.ts"])).toEqual(["A", "a"]));
  test("file_beside_same_name_folder_fails", () => expect(flagged(["docs", "Docs/x.md"])).toEqual(["Docs", "docs"]));
  test("case_pair_reported_once_at_top", () => expect(flagged(["a/b/x.ts", "A/B/X.ts"])).toEqual(["A", "a"]));

  test("nfc_nfd_pair_fails", () => expect(flagged(["caf\u00e9.md", "cafe\u0301.md"])).toHaveLength(2));
  test("final_sigma_pair_fails", () => expect(flagged(["\u03c3.ts", "\u03c2.ts"])).toHaveLength(2));

  test("case_pair_names_the_other_path", () => {
    expect(caseCollision.findCaseCollisions(["b.ts", "Foo.ts", "foo.ts"])).toEqual([
      {
        file: "Foo.ts",
        line: 1,
        rule: "case-collision",
        text: "same name as foo.ts on a case-insensitive file system",
      },
      {
        file: "foo.ts",
        line: 1,
        rule: "case-collision",
        text: "same name as Foo.ts on a case-insensitive file system",
      },
    ]);
  });

  test("git_error_fails_closed", () => {
    expect(() => caseCollision.scanAll(tempRepo({ "a.ts": "" }))).toThrow(/not a git repository/);
  });

  test("case_guard_fails_closed_on_empty_index", () => {
    expect(() => caseCollision.scanAll(indexedRepo([]))).toThrow(/listed no paths/);
  });
});

/** A temp repo with `files` written and added to the index, for guards that read tracked files. */
function trackedRepo(files: Record<string, string | Uint8Array>): string {
  const root = tempRepo(files);
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { env: fixtureGitEnv(), stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  return root;
}

function expectConflictFixtures(kind: "bad" | "good"): void {
  const { files, expected } = readFixtures("conflict-markers", kind);
  expect(countFindings(Object.keys(files), conflictMarkers.scanAll(trackedRepo(files)))).toEqual(expected);
}

describe("conflict-markers", () => {
  // Built at run time so this file holds no marker of its own.
  const open = `${"<".repeat(7)} HEAD`;
  const base = `${"|".repeat(7)} base`;
  const middle = "=".repeat(7);
  const close = `${">".repeat(7)} origin/main`;

  test("conflict_in_docs_and_code_fails", () => expectConflictFixtures("bad"));
  test("lookalike_lines_pass", () => expectConflictFixtures("good"));

  test("each_marker_line_is_named", () => {
    const text = ["a", open, "b", base, "c", middle, "d", close, ""].join("\n");
    expect(conflictMarkers.findConflictMarkers("docs/x.md", text).map((f) => f.line)).toEqual([2, 4, 8]);
  });

  test("crlf_and_bare_markers_fail", () => {
    const text = `${"<".repeat(7)}\r\nx\r\n${">".repeat(7)}\r\n`;
    expect(conflictMarkers.findConflictMarkers("a.ts", text)).toHaveLength(2);
  });

  test("untracked_and_fixture_files_are_not_read", () => {
    const root = trackedRepo({ "a.md": "fine\n", "scripts/guards/fixtures/x/bad.fixture": `${open}\n` });
    writeFileSync(join(root, "untracked.md"), `${open}\n`);
    expect(conflictMarkers.scanAll(root)).toEqual([]);
  });

  test("binary_files_are_skipped", () => {
    const bytes = new Uint8Array([0, ...new TextEncoder().encode(`\n${open}\n`)]);
    expect(conflictMarkers.scanAll(trackedRepo({ "img.png": bytes, "a.md": "ok\n" }))).toEqual([]);
  });

  test("conflict_guard_fails_closed", () => {
    expect(() => conflictMarkers.scanAll(tempRepo({ "a.md": "" }))).toThrow(/not a git repository/);
    expect(() => conflictMarkers.scanAll(indexedRepo([]))).toThrow(/listed no paths/);
  });
});
