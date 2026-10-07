// P1.30: the strict Compose subset the preflight reads (architecture record 2026-10-07-p130-preflight-location-and-yaml):
// anything Compose could read differently from us is refused rather than guessed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseCompose, parseEnvFile } from "./compose-parse.ts";

describe("compose subset", () => {
  const refused = (yaml: string) => expect(() => parseCompose(yaml, "c.yaml")).toThrow();
  const base = "name: unset-prod\nservices:\n  edge:\n    image: x\n";

  test("preflight_accepts_the_subset", () => {
    const compose = parseCompose(
      `${base}    ports: ["127.0.0.1:2019:2019"]\n    environment: [A=1, B=$$x]\n`,
      "c.yaml",
    );
    expect(compose.services).toMatchObject([
      { name: "edge", ports: [{ hostIp: "127.0.0.1", published: "2019", target: "2019" }] },
    ]);
  });
  test("preflight_refuses_anchor_alias_merge", () => {
    refused(`${base}    environment: &e\n      A: "1"\n  pds:\n    environment: *e\n`);
    refused(`${base}  pds:\n    <<: {image: y}\n`);
  });
  test("preflight_refuses_tags", () => refused(`${base}    user: !!str "1000"\n`));
  test("preflight_refuses_multi_document", () => refused(`${base}---\n${base}`));
  test("preflight_refuses_duplicate_keys", () => refused(`${base}    image: y\n`));
  test("preflight_refuses_include_and_extends", () => {
    refused(`include: [other.yaml]\n${base}`);
    refused(`${base}  pds:\n    extends: edge\n`);
  });
  test("preflight_refuses_interpolation_in_security_fields", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const field of ["image: ${IMG}", "user: ${U}", 'ports: ["${P}:80"]', "env_file: ${F}", "privileged: ${P}"]) {
      refused(`name: unset-prod\nservices:\n  edge:\n    ${field}\n`);
    }
    refused(`${base}    environment:\n      \${K}: v\n`);
    refused(`${base}    environment:\n      A: pre\${B}\n`);
    refused(`${base}    environment:\n      A:\n`);
  });
  test("preflight_refuses_ambiguous_scalars", () => refused(`${base}    environment:\n      A: 0123\n`));
});

describe("env file subset", () => {
  test("preflight_reads_strict_env_files", () => {
    expect(parseEnvFile("# note\n\nA=1\nB=\nC='lit $x'\n", "e.env")).toEqual([
      ["A", "1"],
      ["B", ""],
      ["C", "lit $x"],
    ]);
    // Anything Compose would interpolate, unquote or split differently is refused.
    for (const line of ['A="q"', "A=$B", "A=a b", "A=a#b", "export A=1", "1A=x"]) {
      expect(() => parseEnvFile(`${line}\n`, "e.env"), line).toThrow();
    }
  });
});

const digest = `sha256:${"a".repeat(64)}`;
const STACK = `name: unset-prod
services:
  edge:
    image: ghcr.io/undefined6799/edge@${digest}
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
  pds:
    image: ghcr.io/undefined6799/mirror/pds@${digest}
    environment:
      PDS_HOSTNAME: pds.example.test
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
`;

/** Whether `docker compose` runs here; CI must have it (the architecture record's anti-drift test runs there). */
const hasCompose = (() => {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("compose agreement", () => {
  const dir = mkdtempSync(join(tmpdir(), "compose-parse-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test.runIf(hasCompose || process.env.CI)("preflight_matches_compose_config", () => {
    const file = join(dir, "compose.yaml");
    writeFileSync(file, STACK);
    // The test (never the preflight) asks Compose for its reading of the same file.
    const json = execFileSync("docker", ["compose", "-f", file, "config", "--format", "json", "--no-interpolate"], {
      encoding: "utf8",
    });
    const theirs = JSON.parse(json) as {
      name: string;
      services: Record<string, { image: string; ports?: { target: number; published?: string; host_ip?: string }[] }>;
    };
    const ours = parseCompose(STACK, file);
    expect(theirs.name).toBe(ours.name);
    expect(Object.keys(theirs.services).sort()).toEqual(ours.services.map((s) => s.name).sort());
    for (const service of ours.services) {
      const their = theirs.services[service.name];
      expect(their?.image).toBe(service.image);
      expect(
        (their?.ports ?? []).map((p) => ({
          hostIp: p.host_ip ?? null,
          published: p.published ?? null,
          target: `${p.target}`,
        })),
      ).toEqual(service.ports);
    }
  });
});
