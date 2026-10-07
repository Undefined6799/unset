// P1.27: the image's bases are pinned and the Dockerfile ships only what production runs (step book P1.27; architecture
// ruling 2026-10-06 23:15Z, book edit 2026-10-06-p127-upstream-base-by-digest). Every FROM, the build stages included,
// names its base by the multi-arch index digest recorded in deployment/images/bases.lock.json, from a host on a fixed
// allowlist: Docker's official library images, each named (interim, until P1.27s mirrors them and flips the host; book edit
// 2026-10-07-p128-edge-bases-and-ratelimit-adr widened it from Node alone for the edge's Caddy bases) and our GHCR
// namespace. The build itself (hadolint, Trivy, non-root, no dev dependencies, healthy) runs in the images workflow.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const DOCKERFILE = "images/node-app.Dockerfile";

/**
 * What an image is built FROM; the deploy contract (images.lock.json, verify-images) arrives with P1.27s. `stage` says
 * whether the base may become a shipped image (`runtime`) or only builds one (`build`); it is required (P1.28d, book
 * edit 2026-10-07-p128v-mirror-scan-stage), so the mirror scan can tell them apart (P1.28v).
 */
type Base = { ref: string; tag: string; digest: string; source: "upstream" | "mirror"; stage: Stage };
type Stage = "build" | "runtime";
type MirrorEntry = { source: string; mirror: string; stage: Stage };
type Lock = Record<string, Base>;

/** Where a base may come from: each official library image by name (interim; never a wildcard) and our GHCR namespace. */
const LIBRARY_IMAGES = new Set(["docker.io/library/node", "docker.io/library/caddy"]);
const OWN_NAMESPACE = /^ghcr\.io\/undefined6799\/[a-z0-9._/-]+$/;
const allowed = (ref: string): boolean => LIBRARY_IMAGES.has(ref) || OWN_NAMESPACE.test(ref);
const FROM = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
const PINNED = /^([a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+)(?::([\w][\w.-]{0,127}))?@(sha256:[0-9a-f]{64})$/;

/** The image each FROM names, with stage names left out (a FROM may build on an earlier stage). */
function fromImages(dockerfile: string): string[] {
  const stages = new Set<string>();
  const images: string[] = [];
  for (const line of dockerfile.split("\n")) {
    const match = FROM.exec(line.trim());
    if (match === null) continue;
    const [, image = "", stage] = match;
    if (!stages.has(image)) images.push(image);
    if (stage !== undefined) stages.add(stage);
  }
  return images;
}

/** Every problem with the Dockerfile's bases against the lock, empty when each FROM is pinned, allowed and locked. */
function baseProblems(dockerfile: string, lock: Lock): string[] {
  const images = fromImages(dockerfile);
  if (images.length === 0) return ["the Dockerfile has no FROM"];
  return images.flatMap((image) => {
    const pinned = PINNED.exec(image);
    if (pinned === null) return [`FROM ${image} is not pinned by digest`];
    const [, ref = "", , digest = ""] = pinned;
    if (!allowed(ref)) return [`FROM ${image} is not from an allowed host`];
    const locked = Object.values(lock).find((base) => base.ref === ref);
    if (locked === undefined) return [`FROM ${image} has no lock entry`];
    return locked.digest === digest ? [] : [`FROM ${image} differs from the lock digest ${locked.digest}`];
  });
}

const STAGES: readonly unknown[] = ["build", "runtime"];

/** Every lock or mirror-list entry without a known stage, and every mirror entry whose stage differs from its lock's. */
function stageProblems(lock: Lock, list: MirrorEntry[]): string[] {
  const locked = Object.entries(lock).flatMap(([name, base]) =>
    STAGES.includes(base.stage) ? [] : [`lock entry ${name} has no stage`],
  );
  const listed = list.flatMap((entry) => {
    if (!STAGES.includes(entry.stage)) return [`mirror entry ${entry.source} has no stage`];
    const base = Object.values(lock).find((b) => entry.source === `${b.ref}:${b.tag}@${b.digest}`);
    return base === undefined || base.stage === entry.stage ? [] : [`mirror entry ${entry.source} differs in stage`];
  });
  return [...locked, ...listed];
}

/**
 * What the final stage is built FROM, following stage names back to their base: a `build` base may only feed earlier
 * stages, so the shipped image is a `runtime` base or `scratch`.
 */
function finalStageProblems(dockerfile: string, lock: Lock): string[] {
  const stageBase = new Map<string, string>();
  let last: string | undefined;
  for (const line of dockerfile.split("\n")) {
    const match = FROM.exec(line.trim());
    if (match === null) continue;
    const [, image = "", stage] = match;
    last = stageBase.get(image) ?? image;
    if (stage !== undefined) stageBase.set(stage, last);
  }
  if (last === undefined) return ["the Dockerfile has no FROM"];
  if (last === "scratch") return [];
  const ref = PINNED.exec(last)?.[1];
  const base = Object.values(lock).find((b) => b.ref === ref && last?.endsWith(`@${b.digest}`));
  if (base === undefined) return [`final FROM ${last} has no lock entry`];
  return base.stage === "runtime" ? [] : [`final FROM ${last} is a ${base.stage} base`];
}

/**
 * Images and URLs named outside FROM (P1.28u; architecture record 2026-10-07-p128-copy-from-image-ref): `COPY --from=`
 * and a `RUN --mount` `from=` may name only an earlier stage, by alias (case-insensitive, as BuildKit matches it) or
 * index. An image that is really needed gets its own `FROM … AS name` stage, so every rule above applies to it; there
 * is no allowlist. Read against the Dockerfile reference (docs.docker.com/reference/dockerfile, "COPY --from",
 * "RUN --mount", "ADD", "Parser directives"). Anything this reader cannot parse is a problem, never a skip.
 * P1.28t (architecture record 2026-10-07-p128u-reader-gaps): where BuildKit's exact behaviour is unconfirmed, the reader
 * refuses more, never less. ADD is refused outright (hadolint DL3020); flags and mount keys are read in any letter case;
 * the `syntax` and `escape` parser directives are refused (an unpinned frontend image; a different line join).
 */
const INSTRUCTIONS = new Set(
  "ADD ARG CMD COPY ENTRYPOINT ENV EXPOSE FROM HEALTHCHECK LABEL MAINTAINER ONBUILD RUN SHELL STOPSIGNAL USER VOLUME WORKDIR".split(
    " ",
  ),
);

/** A reason the reader could not parse the Dockerfile; `line` when it is known where the problem was found. */
class Unparsed extends Error {
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

const INSTRUCTION = /^([A-Za-z]+)(?:\s+(.*))?$/;
const HEREDOC = /<<-?\s*["']?[A-Za-z_]/;

/** Logical instructions with the line each starts on: comment lines dropped, `\` continuations joined. */
function instructions(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let open: { line: number; text: string } | undefined;
  for (const [at, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    const directive = /^#\s*(syntax|escape)\s*=/i.exec(line)?.[1];
    if (directive !== undefined)
      throw new Unparsed(`parser directive ${directive.toLowerCase()} not supported`, at + 1);
    if (line === "" || line.startsWith("#")) continue;
    const body = line.endsWith("\\") ? line.slice(0, -1).trimEnd() : line;
    open = open === undefined ? { line: at + 1, text: body } : { line: open.line, text: `${open.text} ${body}` };
    if (!line.endsWith("\\")) {
      out.push(open);
      open = undefined;
    }
  }
  if (open !== undefined) out.push(open);
  return out;
}

/** The leading `--flag` words of an instruction's arguments, and the rest; flag names are lower-cased (`--FROM=x`). */
function splitFlags(args: string): { flags: string[]; rest: string } {
  const flags: string[] = [];
  let rest = args;
  for (let match = /^(--\S*)\s*/.exec(rest); match !== null; match = /^(--\S*)\s*/.exec(rest)) {
    flags.push((match[1] as string).replace(/^--[A-Za-z-]+/, (name) => name.toLowerCase()));
    rest = rest.slice(match[0].length);
  }
  return { flags, rest };
}

/** Whether a name is an earlier stage's alias or index. */
type Earlier = (name: string) => boolean;

function fromFlagProblems(keyword: string, flags: string[], earlier: Earlier): string[] {
  return flags
    .filter((flag) => flag.startsWith("--from"))
    .flatMap((flag) => {
      const from = /^--from=(.*)$/.exec(flag)?.[1];
      if (from === undefined) throw new Unparsed(`cannot parse ${keyword} flag --from`);
      return earlier(from) ? [] : [`${keyword} --from=${from} is not an earlier stage`];
    });
}

/** Each `--mount` is comma-separated key=value pairs; `from=` may sit anywhere among them. Quotes are not read. */
function mountProblems(flags: string[], earlier: Earlier): string[] {
  return flags
    .filter((flag) => flag.startsWith("--mount"))
    .flatMap((flag) => {
      const mount = /^--mount=([^"']*)$/.exec(flag)?.[1];
      if (mount === undefined) throw new Unparsed("cannot parse RUN --mount");
      return mount.split(",").flatMap((part) => {
        const [key = "", ...value] = part.split("=");
        const from = value.join("=");
        return key.toLowerCase() === "from" && !earlier(from)
          ? [`RUN --mount from=${from} is not an earlier stage`]
          : [];
      });
    });
}

/** What one instruction after the first FROM names outside FROM; ONBUILD's instruction is held to the same rule. */
function instructionProblems(keyword: string, args: string, earlier: Earlier): string[] {
  if (keyword === "ONBUILD") {
    const [, inner, rest = ""] = INSTRUCTION.exec(args) ?? [];
    if (inner === undefined) throw new Unparsed("cannot parse ONBUILD");
    return instructionProblems(inner.toUpperCase(), rest, earlier);
  }
  if (keyword === "ADD") return ["ADD is not allowed; use COPY"];
  if (!["RUN", "COPY"].includes(keyword)) return [];
  if (HEREDOC.test(args)) throw new Unparsed("heredoc not supported");
  const { flags } = splitFlags(args);
  if (keyword === "RUN") return mountProblems(flags, earlier);
  return fromFlagProblems(keyword, flags, earlier);
}

/** The stages declared so far: each FROM enters one, and `earlier` answers for the stage being read. */
function stages() {
  const aliases = new Map<string, number>();
  let current = -1;
  return {
    started: (): boolean => current >= 0,
    enter(instruction: string): void {
      const from = FROM.exec(instruction);
      if (from === null) throw new Unparsed("cannot parse FROM");
      current += 1;
      if (from[2] !== undefined) aliases.set(from[2].toLowerCase(), current);
    },
    earlier: (name: string): boolean => {
      const index = /^\d+$/.test(name) ? Number(name) : aliases.get(name.toLowerCase());
      return index !== undefined && index < current;
    },
  };
}

/** One instruction: FROM enters a stage; anything else before the first FROM but ARG is unparseable. */
function readInstruction(stage: ReturnType<typeof stages>, instruction: string): string[] {
  const [, word = "", args = ""] = INSTRUCTION.exec(instruction) ?? [];
  const keyword = word.toUpperCase();
  if (!INSTRUCTIONS.has(keyword)) throw new Unparsed(`unknown instruction ${keyword || instruction}`);
  if (keyword === "FROM") {
    stage.enter(instruction);
    return [];
  }
  if (!stage.started() && keyword !== "ARG") throw new Unparsed(`${keyword} before the first FROM`);
  return instructionProblems(keyword, args, stage.earlier);
}

/** Every image or URL named outside FROM, and the first instruction this reader cannot parse; empty when there is none. */
function referenceProblems(text: string): string[] {
  const problems: string[] = [];
  const stage = stages();
  let line = 0;
  try {
    for (const instruction of instructions(text)) {
      line = instruction.line;
      problems.push(...readInstruction(stage, instruction.text).map((problem) => `line ${line}: ${problem}`));
    }
  } catch (error) {
    if (!(error instanceof Unparsed)) throw error;
    return [...problems, `line ${error.line ?? line}: ${error.message}`];
  }
  return stage.started() ? problems : ["the Dockerfile has no FROM"];
}

/** Every Dockerfile under deployment/ (the web image's and, from P1.28, the edge's), so a new image is covered too. */
const dockerfiles = (readdirSync(DEPLOYMENT, { recursive: true }) as string[])
  .filter((file) => /(^|\/)([\w.-]+\.)?Dockerfile$/.test(file) && !file.includes("node_modules"))
  .sort();

const dockerfile = read(DOCKERFILE);
const lock = JSON.parse(read("images/bases.lock.json")) as Lock;
const NODE = lock.node as Base;
const pinnedNode = `docker.io/library/node:${NODE.tag}@${NODE.digest}`;

describe("base images", () => {
  test("base_digest_matches_lock", () => {
    expect(baseProblems(dockerfile, lock)).toEqual([]);
    expect(fromImages(dockerfile).length).toBeGreaterThanOrEqual(2);
    const other = `sha256:${"1".repeat(64)}`;
    expect(baseProblems(`FROM docker.io/library/node:${NODE.tag}@${other} AS build`, lock)).toEqual([
      `FROM docker.io/library/node:${NODE.tag}@${other} differs from the lock digest ${NODE.digest}`,
    ]);
    // A later stage may build on an earlier one by name; only real images are checked.
    expect(baseProblems(`FROM ${pinnedNode} AS build\nFROM build AS test`, lock)).toEqual([]);
  });

  test("from_without_digest_refused", () => {
    for (const image of [`docker.io/library/node:${NODE.tag}`, "node:26", "docker.io/library/node@sha256:abc"]) {
      expect(baseProblems(`FROM ${image}`, lock)).toEqual([`FROM ${image} is not pinned by digest`]);
    }
    expect(baseProblems("RUN true", lock)).toEqual(["the Dockerfile has no FROM"]);
  });

  test("from_host_not_allowlisted_refused", () => {
    for (const ref of [
      "quay.io/library/node",
      "docker.io/someone/node",
      "docker.io/library/a/node",
      "docker.io/library/nginx",
      "ghcr.io/someone-else/node",
    ]) {
      const image = `${ref}:${NODE.tag}@${NODE.digest}`;
      expect(baseProblems(`FROM --platform=linux/amd64 ${image}`, lock)).toEqual([
        `FROM ${image} is not from an allowed host`,
      ]);
    }
  });

  test("lock_records_the_index_digest", () => {
    expect(Object.keys(lock)).toEqual(["node", "caddy-builder", "caddy"]);
    // Exact keys only: toStrictEqual refuses any key the record does not name.
    expect(NODE).toStrictEqual({
      ref: "docker.io/library/node",
      tag: expect.stringMatching(/^26(?:\.\d+){0,2}-[a-z]+-slim$/),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      source: "upstream",
      stage: "runtime",
    });
    // The edge's bases (P1.28): Caddy's builder and runtime images, both Alpine, both by index digest.
    // The builder only builds the edge binary; the runtime image is what ships.
    for (const [name, tag, stage] of [
      ["caddy-builder", /^2\.11\.7-builder-alpine$/, "build"],
      ["caddy", /^2\.11\.7-alpine$/, "runtime"],
    ] as const) {
      expect(lock[name], name).toStrictEqual({
        ref: "docker.io/library/caddy",
        tag: expect.stringMatching(tag),
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        source: "upstream",
        stage,
      });
    }
  });

  test("runtime_base_is_debian_slim", () => {
    // Alex, 2026-10-07 01:29:53Z, "Debian slim" (P1.27d): the web image runs on Debian trixie slim. Every stage uses the
    // one locked base.
    expect(NODE.ref).toBe("docker.io/library/node");
    expect(NODE.tag).toMatch(/^26(?:\.\d+){0,2}-[a-z]+-slim$/);
    for (const image of fromImages(dockerfile)) expect(image, image).toBe(pinnedNode);
  });

  test("runtime_stage_installs_no_os_packages", () => {
    // No stage installs OS packages, so no apt or apk line needs version pins (DL3008, DL3018) and the runtime holds
    // only what the base ships.
    for (const line of dockerfile.split("\n")) {
      expect(line, line).not.toMatch(/^\s*RUN\b.*\b(?:apt-get|apt|apk|dpkg)\b/);
    }
  });

  test("dl3026_ignore_only_on_upstream_base", () => {
    const lines = dockerfile.split("\n").map((line) => line.trim());
    const ignores = lines.flatMap((line, at) => (/hadolint\b.*ignore/i.test(line) ? [at] : []));
    const upstream = Object.values(lock).filter((base) => base.source === "upstream");
    const upstreamFroms = fromImages(dockerfile).filter((image) =>
      upstream.some((base) => PINNED.exec(image)?.[1] === base.ref),
    );
    expect(ignores.length).toBe(upstreamFroms.length);
    for (const at of ignores) {
      // hadolint applies an inline ignore to the next line only (src/Hadolint/Pragma.hs, `line + 1`, v2.15.1), so the
      // FROM follows the ignore directly and the reason sits in the comment line above it.
      expect(lines[at]).toBe("# hadolint ignore=DL3026");
      expect(lines[at - 1]).toMatch(/^# .*2026-10-06-p127-upstream-base-by-digest.*removed by P1\.27s/);
      const from = lines[at + 1] ?? "";
      const ref = PINNED.exec(FROM.exec(from)?.[1] ?? "")?.[1];
      expect(
        upstream.map((base) => base.ref),
        from,
      ).toContain(ref);
    }
  });

  test("mirror_list_digest_only", () => {
    const list = JSON.parse(read("mirror.list.json")) as MirrorEntry[];
    // Every upstream base in the lock is scanned weekly by the mirror workflow, and nothing else is listed.
    const upstream = Object.values(lock)
      .filter((base) => base.source === "upstream")
      .map((base) => `${base.ref}:${base.tag}@${base.digest}`);
    expect(list.map((entry) => entry.source)).toEqual(upstream);
    expect(upstream).toContain(pinnedNode);
    for (const entry of list) {
      expect(entry.source, entry.source).toMatch(PINNED);
      expect(entry.mirror, entry.source).toMatch(/^ghcr\.io\/undefined6799\/mirror\/[a-z0-9._-]+$/);
    }
  });

  test("every_lock_entry_has_stage", () => {
    const list = JSON.parse(read("mirror.list.json")) as MirrorEntry[];
    expect(stageProblems(lock, list)).toEqual([]);
    expect(list.map((entry) => entry.stage)).toEqual(Object.values(lock).map((base) => base.stage));
    const { stage: _, ...unlabelled } = NODE;
    const source = pinnedNode;
    expect(stageProblems({ node: unlabelled as Base }, [])).toEqual(["lock entry node has no stage"]);
    expect(stageProblems({ node: { ...NODE, stage: "test" as Stage } }, [])).toEqual(["lock entry node has no stage"]);
    expect(stageProblems(lock, [{ source, mirror: "m" } as MirrorEntry])).toEqual([
      `mirror entry ${source} has no stage`,
    ]);
    expect(stageProblems(lock, [{ source, mirror: "m", stage: "build" }])).toEqual([
      `mirror entry ${source} differs in stage`,
    ]);
  });

  test("build_stage_bases_never_in_final_stage", () => {
    expect(dockerfiles).toContain(DOCKERFILE);
    for (const file of dockerfiles) expect(finalStageProblems(read(file), lock), file).toEqual([]);
    const builder = lock["caddy-builder"] as Base;
    const runtime = lock.caddy as Base;
    const build = `${builder.ref}:${builder.tag}@${builder.digest}`;
    const ship = `${runtime.ref}:${runtime.tag}@${runtime.digest}`;
    // The edge's shape: the builder feeds a stage the runtime image copies from.
    expect(finalStageProblems(`FROM ${build} AS b\nFROM ${ship}\nCOPY --from=b /out /app`, lock)).toEqual([]);
    expect(finalStageProblems(`FROM ${ship} AS b\nFROM ${build}`, lock)).toEqual([
      `final FROM ${build} is a build base`,
    ]);
    expect(finalStageProblems(`FROM ${build} AS b\nFROM b AS c\nFROM c`, lock)).toEqual([
      `final FROM ${build} is a build base`,
    ]);
    expect(finalStageProblems(`FROM ${build} AS b\nFROM scratch`, lock)).toEqual([]);
    expect(finalStageProblems(`FROM ${ship.replace(runtime.digest, `sha256:${"1".repeat(64)}`)}`, lock)).toEqual([
      `final FROM ${ship.replace(runtime.digest, `sha256:${"1".repeat(64)}`)} has no lock entry`,
    ]);
  });
});

describe("references outside FROM", () => {
  const node = pinnedNode;
  const twoStages = `FROM ${node} AS build\nFROM ${node}\n`;

  test("copy_from_image_ref_refused", () => {
    for (const ref of [node, "alpine", "later"]) {
      expect(referenceProblems(`${twoStages}COPY --from=${ref} /a /b\nFROM ${node} AS later\n`), ref).toEqual([
        `line 3: COPY --from=${ref} is not an earlier stage`,
      ]);
    }
    // The flag may sit after another flag, and an empty value or the stage itself is no earlier stage either.
    expect(referenceProblems(`${twoStages}COPY --chown=1:1 --from=${node} /a /b`)).toEqual([
      `line 3: COPY --from=${node} is not an earlier stage`,
    ]);
    expect(referenceProblems(`FROM ${node} AS self\nCOPY --from=self /a /b\nCOPY --from= /a /b`)).toEqual([
      "line 2: COPY --from=self is not an earlier stage",
      "line 3: COPY --from= is not an earlier stage",
    ]);
  });

  test("run_mount_from_image_ref_refused", () => {
    for (const mount of [
      `type=bind,from=${node},target=/x`,
      `target=/x,type=cache,from=alpine`,
      `from=alpine,type=bind,source=/,target=/x`,
    ]) {
      const from = /from=([^,]*)/.exec(mount)?.[1];
      expect(referenceProblems(`${twoStages}RUN --network=none --mount=${mount} true`), mount).toEqual([
        `line 3: RUN --mount from=${from} is not an earlier stage`,
      ]);
    }
    expect(
      referenceProblems(`${twoStages}RUN --mount=type=cache,target=/c --mount=type=bind,from=build,target=/x true`),
    ).toEqual([]);
  });

  test("add_refused", () => {
    // ADD's extra powers (URLs, git refs, tar extraction) bring in unpinned content, and a variable hides its source.
    for (const args of [
      "local.tar /opt/",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a Dockerfile build argument, not a JS template.
      "${SRC} /opt/",
      "deploy@example.com:o/r /opt/",
      "https://example.com/tool.tar.gz /opt/",
      '["local.tar", "/opt/"]',
      "--chown=1:1 local.tar /opt/",
    ]) {
      expect(referenceProblems(`FROM ${node}\nADD ${args}`), args).toEqual(["line 2: ADD is not allowed; use COPY"]);
    }
    expect(referenceProblems(`FROM ${node}\nadd local.tar /opt/\nONBUILD ADD local.tar /opt/`)).toEqual([
      "line 2: ADD is not allowed; use COPY",
      "line 3: ADD is not allowed; use COPY",
    ]);
  });

  test("mount_from_key_any_case_refused", () => {
    // BuildKit's flag and mount-key letter case is unconfirmed, so every case is read as the lower-case one.
    for (const key of ["FROM", "From", "fRoM"]) {
      expect(referenceProblems(`${twoStages}RUN --mount=type=bind,${key}=img,target=/x true`), key).toEqual([
        "line 3: RUN --mount from=img is not an earlier stage",
      ]);
    }
    expect(referenceProblems(`${twoStages}RUN --MOUNT=from=img,target=/x true\nCOPY --FROM=img /a /b`)).toEqual([
      "line 3: RUN --mount from=img is not an earlier stage",
      "line 4: COPY --from=img is not an earlier stage",
    ]);
  });

  test("syntax_directive_refused", () => {
    for (const directive of ["# syntax=docker/dockerfile:1", "#syntax = docker/dockerfile:1", "# SYNTAX=x"]) {
      expect(referenceProblems(`${directive}\nFROM ${node}`), directive).toEqual([
        "line 1: parser directive syntax not supported",
      ]);
    }
  });

  test("escape_directive_refused", () => {
    for (const directive of ["# escape=`", "#Escape = \\"]) {
      expect(referenceProblems(`${directive}\nFROM ${node}`), directive).toEqual([
        "line 1: parser directive escape not supported",
      ]);
    }
  });

  test("copy_from_stage_alias_or_index_allowed", () => {
    const text = `FROM ${node} AS Build\nFROM ${node} AS deps\nFROM ${node}\nCOPY --from=build /a /a\nCOPY --from=BUILD /a /a\nCOPY \\\n  --from=1 /b /b\nCOPY --from=0 /c /c`;
    expect(referenceProblems(text)).toEqual([]);
    // An index names a stage by position: the current and later ones are not earlier stages.
    expect(referenceProblems(`${twoStages}COPY --from=1 /a /b\nCOPY --from=2 /a /b`)).toEqual([
      "line 3: COPY --from=1 is not an earlier stage",
      "line 4: COPY --from=2 is not an earlier stage",
    ]);
  });

  test("instruction_parse_failure_fails", () => {
    for (const [text, problem] of [
      [`COPY --from=x /a /b\nFROM ${node}`, "line 1: COPY before the first FROM"],
      [`FROM ${node}\nFETCH https://example.com/x /y`, "line 2: unknown instruction FETCH"],
      [`FROM ${node}\nCOPY --from build /a /b`, "line 2: cannot parse COPY flag --from"],
      [`FROM ${node}\nRUN --mount=type=bind,"from=x",target=/y true`, "line 2: cannot parse RUN --mount"],
      [`FROM ${node}\nCOPY <<EOF /x\nhello\nEOF`, "line 2: heredoc not supported"],
      [`FROM ${node} AS a b`, "line 1: cannot parse FROM"],
      ["", "the Dockerfile has no FROM"],
    ] as const) {
      expect(referenceProblems(text), text).toEqual([problem]);
    }
    // ONBUILD carries its instruction into a later build, so the inner one is held to the same rule.
    expect(referenceProblems(`FROM ${node}\nONBUILD COPY --from=alpine /a /b`)).toEqual([
      "line 2: COPY --from=alpine is not an earlier stage",
    ]);
  });

  test("real_dockerfiles_name_images_only_in_from", () => {
    // A floor, not an exact list: a new Dockerfile under deployment/ is checked without editing this test.
    expect(dockerfiles).toEqual(expect.arrayContaining(["edge/Dockerfile", "images/node-app.Dockerfile"]));
    for (const file of dockerfiles) expect(referenceProblems(read(file)), file).toEqual([]);
  });
});

/** The instructions of the last stage, the one that becomes the image, with continuation lines joined. */
const runtimeStage = (text: string): string[] =>
  (text.split(/^FROM .*$/m).at(-1) ?? "")
    .replaceAll(/\\\n\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

describe("runtime stage", () => {
  const runtime = runtimeStage(dockerfile);

  test("runtime_runs_as_65532", () => {
    expect(runtime.filter((line) => line.startsWith("USER "))).toEqual(["USER 65532:65532"]);
    // Nothing runs as root once the user is set: no RUN follows it.
    expect(runtime.slice(runtime.indexOf("USER 65532:65532")).filter((line) => line.startsWith("RUN "))).toEqual([]);
  });

  test("prod_image_has_ssr_build_only", () => {
    expect(dockerfile).toMatch(/^RUN npm run build -w @unset\/apps-web$/m);
    const web = runtime.filter((line) => line.includes("apps/web"));
    expect(web).toEqual([
      "COPY --from=build /app/apps/web/package.json apps/web/package.json",
      "COPY --from=build /app/apps/web/dist apps/web/dist",
    ]);
  });

  test("image_has_no_dev_deps", () => {
    expect(dockerfile).toMatch(/^RUN npm ci --ignore-scripts --omit=dev$/m);
    expect(runtime.filter((line) => line.startsWith("COPY ") && line.includes("node_modules"))).toEqual([
      "COPY --from=deps /app/node_modules node_modules",
    ]);
  });

  test("runtime_has_no_package_manager", () => {
    const removal = runtime.find((line) => line.startsWith("RUN rm -rf ")) ?? "";
    for (const path of [
      "/usr/local/lib/node_modules/npm",
      "/usr/local/lib/node_modules/corepack",
      "/opt/yarn-*",
      ...["npm", "npx", "corepack", "yarn", "yarnpkg", "pnpm", "pnpx"].map((tool) => `/usr/local/bin/${tool}`),
    ]) {
      expect(removal.split(" "), path).toContain(path);
    }
    expect(runtime.indexOf(removal)).toBeLessThan(runtime.indexOf("USER 65532:65532"));
    // The build and deps stages keep npm: they run npm ci.
    expect(
      dockerfile
        .split(/^FROM .*$/m)
        .slice(1, -1)
        .join(""),
    ).not.toContain("rm -rf");
  });

  test("runtime_entry_is_the_web_server", () => {
    expect(runtime).toContain('ENTRYPOINT ["node", "interfaces/http/main.ts"]');
    expect(runtime.some((line) => line.startsWith("HEALTHCHECK ") && line.includes("/health"))).toBe(true);
  });
});
