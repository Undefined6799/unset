// P1.37y (ADR 0036): compose.dev.source.yaml is compose.dev.yaml with its first-party services (six since P2.18s, ADR 0041) built from the
// checkout, as compose.local.yaml builds them, and nothing else changed. Derived here from the two files, so the dev
// file stays the one place a dev service is written.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type Compose, parseCompose } from "./preflight/compose-parse.ts";
import {
  CHAT_NETWORKS,
  CHAT_SECRETS,
  CHAT_SERVICES,
  SOURCE_ONLY_NETWORKS,
  SOURCE_ONLY_SERVICES,
} from "./preflight/local-only.ts";

const DEPLOYMENT = import.meta.dirname;
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const parse = (file: string): Compose => parseCompose(read(file), file);
const SOURCE = "compose.dev.source.yaml";
/** The first-party services staging builds (ADR 0036 Decision 1), objects among them since P2.18s; Newt is run from
 * the mirror as under dev. */
const BUILT = ["postgres", "migrate", "pds", "edge", "web", "objects"];
/**
 * The services staging builds from the checkout with no published image yet, and their networks: Alex, 2026-11-19T00:43Z,
 * "i dont think we should make image it for everything, lets build the next image when we are ready to push something
 * to prod" and "for now deploy from source". The list lives in local-only.ts, so C17 reads the same one.
 */
const SOURCE_ONLY = [...SOURCE_ONLY_SERVICES];
/** Every service the source file has and the dev file has not: the source-only ones and the chat ones. */
const SOURCE_EXTRA: ReadonlySet<string> = new Set([...SOURCE_ONLY_SERVICES, ...CHAT_SERVICES]);

/**
 * The source file without what only it has: each source-only service's block (its comment lines with it), the
 * top-level network, volume and secret entries only those services use, and their networks in any other service's
 * list. What is left must be the dev file with the builds swapped in.
 */
function withoutSourceOnly(text: string): string {
  const source = parseCompose(text, SOURCE);
  const only = source.services.filter((s) => SOURCE_EXTRA.has(s.name));
  const others = source.services.filter((s) => !SOURCE_EXTRA.has(s.name));
  const ownVolumes = new Set(
    only.flatMap((s) => s.mounts.filter((m) => m.type === "volume").map((m) => m.source)).filter((v) => v !== null),
  );
  const ownSecrets = new Set(only.flatMap((s) => s.secrets));
  for (const s of others) {
    for (const m of s.mounts) if (m.source !== null) ownVolumes.delete(m.source);
    for (const name of s.secrets) ownSecrets.delete(name);
  }
  const entry = (name: string) => name.replace(/[.]/g, "\\.");
  let rest = text;
  for (const name of SOURCE_EXTRA) {
    rest = rest.replace(new RegExp(`(?:^  #.*\\n)*^  ${entry(name)}:\\n(?:^ {4}.*\\n)*\\n`, "m"), "");
  }
  for (const name of [...SOURCE_ONLY_NETWORKS, ...CHAT_NETWORKS]) {
    rest = rest.replace(new RegExp(`(?:^  #.*\\n)*^  ${entry(name)}:\\n(?:^ {4}.*\\n)*`, "m"), "");
    rest = rest.replaceAll(new RegExp(`(^    networks: \\[.*), ${entry(name)}(?=[,\\]])`, "gm"), "$1");
    // A network in a block-form list (the edge's), with its address if it has one.
    rest = rest.replaceAll(new RegExp(`^      ${entry(name)}:\\n(?:^ {8}.*\\n)*`, "gm"), "");
  }
  // The edge's chat site (P6.02): its mount, with the comment above it, and its three values.
  rest = rest.replace(/(?:^ {6}#.*\n)*^ {6}- \.\/edge\/dev\/chat\.caddy:.*\n/m, "");
  rest = rest.replaceAll(/^ {6}(?:CHAT_HOST|CHAT_UPSTREAM|MATRIX_UPSTREAM): .*\n/gm, "");
  // A chat secret in another service's list (Postgres's two, for chat-databases.sh).
  for (const name of CHAT_SECRETS) {
    rest = rest.replaceAll(new RegExp(`(^    secrets: \\[.*), ${entry(name)}(?=[,\\]])`, "gm"), "$1");
    ownSecrets.add(name);
  }
  for (const name of [...ownVolumes, ...ownSecrets]) {
    rest = rest.replace(new RegExp(`(?:^  #.*\\n)*^  ${entry(name)}:\\n(?:^ {4}.*\\n)*`, "m"), "");
  }
  return rest;
}

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
    expect(code(withoutSourceOnly(read(SOURCE)))).toBe(code(expected));
  });

  test("source_only_services_are_built_and_stay_out_of_the_image_stack", () => {
    // Each listed service is in the source file and the local file, built from the same Dockerfile, and in neither the
    // dev file nor its networks: the image stack runs only locked digests, and none is locked for these yet.
    const source = parse(SOURCE);
    const local = parse("compose.local.yaml");
    const dev = parse("compose.dev.yaml");
    expect(SOURCE_ONLY.length).toBeGreaterThan(0);
    for (const name of SOURCE_ONLY) {
      const built = source.services.find((s) => s.name === name);
      expect(built?.build, name).not.toBeNull();
      expect(built?.image, name).toBeNull();
      expect(local.services.find((s) => s.name === name)?.build, name).toEqual(built?.build);
      expect(
        dev.services.some((s) => s.name === name),
        name,
      ).toBe(false);
    }
    for (const name of SOURCE_ONLY_NETWORKS) {
      expect(
        source.networks.some((n) => n.name === name),
        name,
      ).toBe(true);
      expect(
        dev.networks.some((n) => n.name === name),
        name,
      ).toBe(false);
      expect(
        dev.services.filter((s) => s.networks.includes(name)).map((s) => s.name),
        name,
      ).toEqual([]);
    }
    // The stripped source file is the dev file, so each source-only service has nothing left behind there.
    // Whole names only: web's own secret web_pds_admin_key belongs to web, which both stacks run.
    expect(withoutSourceOnly(read(SOURCE))).not.toMatch(/\bpds_admin(?:_pds)?\b/);
  });

  test("chat_services_run_on_the_source_stack_alone", () => {
    // P6.02 part 4 (ADR 0098 Decision 2): no chat server under local, and no locked image for any of the four.
    const source = parse(SOURCE);
    const others = [parse("compose.local.yaml"), parse("compose.dev.yaml")];
    for (const name of CHAT_SERVICES) {
      const service = source.services.find((s) => s.name === name);
      expect(service, name).toBeDefined();
      // MAS runs its upstream image as shipped, from the mirror by digest; the other three build from the checkout.
      if (name === "mas") expect(service?.image, name).toMatch(/^ghcr\.io\/undefined6799\/mirror\/[a-z-]+@sha256:/);
      else expect(service?.build, name).not.toBeNull();
      for (const other of others)
        expect(
          other.services.some((s) => s.name === name),
          name,
        ).toBe(false);
    }
    for (const name of CHAT_NETWORKS) {
      expect(source.networks.find((n) => n.name === name)?.internal, name).toBe(true);
      for (const other of others)
        expect(
          other.networks.some((n) => n.name === name),
          name,
        ).toBe(false);
    }
  });

  test("chat_site_is_on_the_source_stacks_edge_alone", () => {
    // P6.02 (ADR 0093 decision 6; Alex 2026-11-21, "Yes, behind Pangolin"): the source stack's edge serves
    // staging.unset.cc from dev/chat.caddy with the ruled values (deployment/edge/adapted-rules.ts DEV_CHAT), on the two
    // chat networks; the image stack's edge, on neither, has no chat site and none of its values.
    const site = "./edge/dev/chat.caddy";
    const edgeOf = (file: string) => parse(file).services.find((s) => s.name === "edge");
    const env = (file: string) => Object.fromEntries(edgeOf(file)?.environment ?? []);
    expect(edgeOf(SOURCE)?.mounts).toContainEqual({
      type: "bind",
      source: site,
      target: "/etc/caddy/sites/enabled/chat.caddy",
      readOnly: true,
    });
    expect(env(SOURCE)).toMatchObject({
      CHAT_HOST: { literal: "staging.unset.cc" },
      CHAT_UPSTREAM: { literal: "10.250.38.43:8090" },
      MATRIX_UPSTREAM: { literal: "10.250.38.51:8008" },
    });
    for (const file of ["compose.dev.yaml", "compose.local.yaml"]) {
      expect(
        edgeOf(file)?.mounts.some((m) => m.source === site),
        file,
      ).toBe(false);
      expect(
        Object.keys(env(file)).filter((name) => /CHAT|MATRIX/.test(name)),
        file,
      ).toEqual([]);
    }
  });

  test("source_services_build_or_run_the_dev_image", () => {
    const source = parse(SOURCE);
    const dev = parse("compose.dev.yaml");
    expect(source.name).toBe(dev.name);
    expect(source.services.map((s) => s.name).filter((name) => !SOURCE_EXTRA.has(name))).toEqual(
      dev.services.map((s) => s.name),
    );
    for (const service of source.services.filter((s) => !SOURCE_EXTRA.has(s.name))) {
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
