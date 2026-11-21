// The settings pages match the generator (P1.21a). A setting, limit or header change that does not regenerate the
// pages fails here, and this file is part of npm test.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkSettings, loadSettingsModel, memberPages, readPdsAdminSettings, stackCell } from "./settings.ts";
import { loadStacks } from "./settings-process.ts";

const ROOT = join(import.meta.dirname, "..", "..");

test("settings_pages_match_their_sources", async () => {
  expect(await checkSettings(ROOT)).toEqual([]);
});

test("every_process_setting_names_a_kind_a_default_and_its_file", async () => {
  const loaded = await loadSettingsModel(ROOT);
  if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
  const web = loaded.model.processes.find((p) => p.process === "web");
  const idle = web?.settings.find((s) => s.key === "SESSION_IDLE_S");
  expect(idle).toMatchObject({ kind: "int", allowed: "300 to 2592000", fallback: "`604800`" });
  expect(idle?.source).toBe("interfaces/web/src/lib/server/config.ts");
  for (const process of loaded.model.processes) {
    for (const setting of process.settings) expect(setting.source, setting.key).not.toBe("not found");
  }
});

test("a_secret_shows_only_that_it_is_set", () => {
  expect(stackCell("PG_PASSWORD", "/run/secrets/pg_web_password", true)).toBe("secret file");
  expect(stackCell("PDS_ADMIN_PASSWORD", "hunter2-not-real", false)).toBe("set (secret, not shown)");
  expect(stackCell("PDS_JWT_SECRET", "abc", false)).not.toContain("abc");
  expect(stackCell("PDS_PLC_ROTATION_KEY", "abc", false)).not.toContain("abc");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a compose interpolation, not a template
  expect(stackCell("WEB_KEY", "${WEB_KEY}", true)).toBe("from env file: `WEB_KEY`");
  expect(stackCell("LOG_LEVEL", "WARN", false)).toBe("`WARN`");
});

test("secret_settings_never_carry_a_value_on_any_page", async () => {
  const loaded = await loadSettingsModel(ROOT);
  if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
  const secrets = loaded.model.processes.flatMap((p) => p.settings.filter((s) => s.secret));
  expect(secrets.length).toBeGreaterThan(0);
  for (const s of secrets) {
    // An optional secret (a feature's switch requires it when on) says so; neither carries a value.
    expect(["required", "optional"]).toContain(s.fallback);
    for (const cell of s.stacks) expect(["secret file", "not set", "not in this stack"]).toContain(cell);
  }
});

test("pds_admin_settings_are_read_from_its_config_source", () => {
  const parsed = readPdsAdminSettings(readFileSync(join(ROOT, "interfaces/pds-admin/config.ts"), "utf8"));
  expect(parsed.problems).toEqual([]);
  expect(parsed.settings).toContainEqual(["INVITE_MAX_PER_WINDOW", "int", "1 to 1000", "`5`"]);
  expect(parsed.settings).toContainEqual(["INVITE_WINDOW_HOURS", "int", "1 to 720", "`24`"]);
  expect(parsed.settings).toContainEqual(["pds_admin_password", "secretFile", "file", "required"]);
});

test("a_pds_admin_read_of_an_unknown_shape_fails_loudly", () => {
  const base = 'export function readConfig(env: NodeJS.ProcessEnv): Config {\n  const a = required(env, "A");\n';
  expect(readPdsAdminSettings(`${base}  const b = Number(env.B);\n}`).problems).toHaveLength(1);
  expect(readPdsAdminSettings(`${base}  const c = env["C"];\n}`).problems).toHaveLength(1);
  expect(readPdsAdminSettings(`${base}  const d = secret(dir, "d");\n}`).problems).toHaveLength(1);
  expect(readPdsAdminSettings(`${base}}`).problems).toEqual([]);
  expect(readPdsAdminSettings("const x = 1;").problems).toHaveLength(1);
});

test("a_member_page_without_a_note_or_a_note_without_a_page_fails", () => {
  const notes = { memberPages: { "/settings/profile": "Profile.", "/settings/gone": "Old." } };
  const result = memberPages(["/prefs/theme", "/settings/profile"], notes);
  expect(result.problems).toEqual([
    "docs/site/data/settings.yaml: /settings/gone is not a page",
    "docs/site/data/settings.yaml: no note for /prefs/theme",
  ]);
});

test("a_compose_service_that_is_not_a_map_fails", () => {
  const root = mkdtempSync(join(tmpdir(), "settings-"));
  try {
    mkdirSync(join(root, "deployment"));
    const compose = "services:\n  web: just-a-string\n  pds:\n    environment:\n      A: b\n";
    for (const file of ["compose.local.yaml", "compose.dev.source.yaml"])
      writeFileSync(join(root, "deployment", file), compose);
    const problems: string[] = [];
    const stacks = loadStacks(root, problems);
    expect(problems).toEqual([
      "deployment/compose.local.yaml: service web is not a map",
      "deployment/compose.dev.source.yaml: service web is not a map",
    ]);
    expect(stacks[0]?.services.get("pds")?.env).toEqual({ A: "b" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
