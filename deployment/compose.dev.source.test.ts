// P1.37y (ADR 0036): compose.dev.source.yaml is compose.dev.yaml with its five first-party services built from the
// checkout, as compose.local.yaml builds them, and nothing else changed. Derived here from the two files, so the dev
// file stays the one place a dev service is written.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type Compose, parseCompose } from "./preflight/compose-parse.ts";

const DEPLOYMENT = import.meta.dirname;
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const parse = (file: string): Compose => parseCompose(read(file), file);
const SOURCE = "compose.dev.source.yaml";
/** The services staging builds (ADR 0036 Decision 1); Newt is run from the mirror as under dev. */
const BUILT = ["postgres", "migrate", "pds", "edge", "web"];
/** A file's YAML without its comment lines: the header differs by design, the services may not. */
const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");

describe("compose.dev.source.yaml against compose.dev.yaml (P1.37y)", () => {
  test("source_file_is_the_dev_file_with_the_local_builds", () => {
    const dev = read("compose.dev.yaml");
    const local = read("compose.local.yaml");
    let expected = dev;
    for (const name of BUILT) {
      const build = local.match(
        new RegExp(`^  ${name}:\\n(    build:\\n      context: .*\\n      dockerfile: .*\\n)`, "m"),
      );
      const image = dev.match(new RegExp(`^  ${name}:\\n(    image: .*\\n)`, "m"));
      expect(build?.[1], `${name} build in compose.local.yaml`).toBeDefined();
      expect(image?.[1], `${name} image in compose.dev.yaml`).toBeDefined();
      expected = expected.replace(`  ${name}:\n${image?.[1]}`, `  ${name}:\n${build?.[1]}`);
    }
    expect(code(read(SOURCE))).toBe(code(expected));
  });

  test("source_services_build_or_run_the_dev_image", () => {
    const source = parse(SOURCE);
    const dev = parse("compose.dev.yaml");
    expect(source.name).toBe(dev.name);
    expect(source.services.map((s) => s.name)).toEqual(dev.services.map((s) => s.name));
    for (const service of source.services) {
      const devService = dev.services.find((s) => s.name === service.name);
      if (BUILT.includes(service.name)) {
        expect(service.build, service.name).not.toBeNull();
        expect(service.image, service.name).toBeNull();
      } else {
        expect(service.build, service.name).toBeNull();
        expect(service.image, service.name).toBe(devService?.image);
      }
    }
  });

  test("source_file_names_its_step_and_record", () => {
    const header = read(SOURCE).split("\n").slice(0, 5).join("\n");
    expect(header).toContain("P1.37y");
    expect(header).toContain("ADR 0036");
    expect(header).toContain("--env dev --source");
  });
});
