// P1.27: the image's bases are pinned and the Dockerfile ships only what production runs (step book P1.27; architecture
// ruling 2026-10-06 23:15Z, book edit 2026-10-06-p127-upstream-base-by-digest). Every FROM, the build stages included,
// names its base by the multi-arch index digest recorded in deployment/images/bases.lock.json, from a host on a fixed
// allowlist: Docker's official library images, each named (interim, until P1.27s mirrors them and flips the host; book edit
// 2026-10-07-p128-edge-bases-and-ratelimit-adr widened it from Node alone for the edge's Caddy bases) and our GHCR
// namespace. The build itself (hadolint, Trivy, non-root, no dev dependencies, healthy) runs in the images workflow.
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const DOCKERFILE = "images/node-app.Dockerfile";
/** The migrate CLI's image (P1.29k; architecture record 2026-10-07-p129-migrate-image-and-run-only-images, point 1). */
const MIGRATE_DOCKERFILE = "images/migrate.Dockerfile";

/**
 * What an image is built FROM; the deploy contract (images.lock.json, verify-images) arrives with P1.27s. `stage` says
 * whether the base may become a shipped image (`runtime`) or only builds one (`build`); it is required (P1.28d, book
 * edit 2026-10-07-p128v-mirror-scan-stage), so the mirror scan can tell them apart (P1.28v). `stripped` lists the
 * absolute paths every image built on the base deletes in its final stage (P1.29x; architecture record
 * 2026-10-07-p129-postgres-image-and-stripped-paths), so the mirror scan may skip exactly those (P1.29v).
 */
type Base = {
  ref: string;
  tag: string;
  digest: string;
  source: "upstream" | "mirror";
  stage: Stage;
  stripped?: string[];
};
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
    const [, ref = ""] = pinned;
    if (!allowed(ref)) return [`FROM ${image} is not from an allowed host`];
    if (!Object.values(lock).some((base) => base.ref === ref)) return [`FROM ${image} has no lock entry`];
    return lockEntriesOf(image, lock).length > 0 ? [] : [`FROM ${image} matches no lock entry by tag and digest`];
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

/** The image the final stage is built FROM, following stage names back to their base; undefined with no FROM. */
function finalFrom(dockerfile: string): string | undefined {
  const stageBase = new Map<string, string>();
  let last: string | undefined;
  for (const line of dockerfile.split("\n")) {
    const match = FROM.exec(line.trim());
    if (match === null) continue;
    const [, image = "", stage] = match;
    last = stageBase.get(image) ?? image;
    if (stage !== undefined) stageBase.set(stage, last);
  }
  return last;
}

/**
 * Every lock entry, by name, that a pinned image reference names exactly: ref, tag and digest (amendment 4), so the
 * runtime digest under a build entry's tag names no entry. One image may be listed more than once.
 */
function lockEntriesOf(image: string, lock: Lock): [string, Base][] {
  const [, ref, tag, digest] = PINNED.exec(image) ?? [];
  return Object.entries(lock).filter(([, b]) => b.ref === ref && b.tag === tag && b.digest === digest);
}

/** The runtime lock entry the final stage builds on, by name; undefined for scratch, a build base or no entry. */
function finalEntry(dockerfile: string, lock: Lock): string | undefined {
  return lockEntriesOf(finalFrom(dockerfile) ?? "", lock).find(([, b]) => b.stage === "runtime")?.[0];
}

/** A `build` base may only feed earlier stages, so the shipped image is a `runtime` base or `scratch`. */
function finalStageProblems(dockerfile: string, lock: Lock): string[] {
  const last = finalFrom(dockerfile);
  if (last === undefined) return ["the Dockerfile has no FROM"];
  if (last === "scratch") return [];
  const entries = lockEntriesOf(last, lock);
  if (entries.length === 0) return [`final FROM ${last} has no lock entry`];
  return entries.some(([, b]) => b.stage === "runtime") ? [] : [`final FROM ${last} is a build base`];
}

/**
 * Lock entries that share a ref (the edge's caddy-builder and caddy) are matched together by `baseProblems`, so they
 * must not widen what a FROM may name (architecture record 2026-10-07-p129-migrate-image-and-run-only-images, amendment
 * 2): entries naming one image (ref and digest) agree on everything but `stage`, and one tag never has two digests.
 */
function sharedRefProblems(lock: Lock): string[] {
  const entries = Object.entries(lock);
  return entries.flatMap(([name, { stage: _, ...base }], at) =>
    entries.slice(at + 1).flatMap(([other, { stage: __, ...next }]) => {
      if (next.ref !== base.ref) return [];
      if (next.digest !== base.digest) {
        return next.tag === base.tag
          ? [`lock entries ${name} and ${other} give ${base.ref}:${base.tag} two digests`]
          : [];
      }
      return isDeepStrictEqual(base, next) ? [] : [`lock entries ${name} and ${other} name one image but differ`];
    }),
  );
}

/**
 * What each image is, by its final stage's runtime lock entry, so the rules for a kind reach every image of that kind
 * (amendment 2): a Dockerfile on any other entry, scratch included, fails `every_dockerfile_has_a_known_kind` rather
 * than falling out of every kind's rules. P1.29d adds `postgres`. The edge kind's package-manager rule is
 * `edge_runtime_has_no_package_manager`: P1.28o removed apk-tools from its Caddy Alpine runtime, and P1.28y fails any
 * edge image whose last apk command does not remove it.
 */
type Kind = "node" | "edge";
/** Lock entry to kind, in kinds.json so the built-image tests iterate the same map (package-manager.image.test.ts). */
const KIND_BY_FINAL_ENTRY = new Map(
  Object.entries(JSON.parse(readFileSync(join(import.meta.dirname, "kinds.json"), "utf8")) as Record<string, Kind>),
);
const kindOf = (dockerfile: string, lock: Lock): Kind | undefined =>
  KIND_BY_FINAL_ENTRY.get(finalEntry(dockerfile, lock) ?? "");

function kindProblems(files: Record<string, string>, lock: Lock): string[] {
  return Object.entries(files).flatMap(([file, text]) =>
    kindOf(text, lock) === undefined ? [`${file} builds on no known kind of image`] : [],
  );
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

/**
 * Logical instructions with the line each starts on: comment lines dropped, `\` continuations joined. A here-doc's
 * body would read as instructions, so a fake `FROM` in it could hide the real final stage from every rule here: any
 * `<<` outside a comment fails, in every stage, whatever follows it (P1.29f, amendment 7 point 1; the repo uses none).
 */
/**
 * BuildKit's line continuation for the default `\` escape (moby/buildkit frontend/dockerfile/parser/parser.go,
 * setEscapeToken and trimContinuationCharacter): a line ending in an unescaped backslash, spaces after it allowed.
 */
const CONTINUATION = /([^\\])\\[ \t]*$|^\\[ \t]*$/;

/**
 * A Dockerfile's instructions, joined as BuildKit joins them (P1.29g, record 2026-10-08-p129f-corpus-gaps item 5):
 * only the backslash-newline goes, a continuation line keeps its leading whitespace, and comment and empty lines inside
 * one are skipped (parser.go, Parse). A here-doc is refused on the joined text, so none hides across a continuation.
 */
function instructions(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let open: { line: number; text: string } | undefined;
  const close = (instruction: { line: number; text: string }): void => {
    if (instruction.text.includes("<<")) throw new Unparsed("heredoc not supported", instruction.line);
    out.push({ line: instruction.line, text: instruction.text.trimEnd() });
  };
  for (const [at, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    const directive = /^#\s*(syntax|escape)\s*=/i.exec(line)?.[1];
    if (directive !== undefined)
      throw new Unparsed(`parser directive ${directive.toLowerCase()} not supported`, at + 1);
    if (line === "" || line.startsWith("#")) continue;
    const continued = CONTINUATION.test(raw);
    const piece = continued ? raw.replace(CONTINUATION, "$1") : raw;
    open =
      open === undefined ? { line: at + 1, text: piece.trimStart() } : { line: open.line, text: open.text + piece };
    if (!continued) {
      close(open);
      open = undefined;
    }
  }
  if (open !== undefined) close(open);
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

/**
 * Every hadolint DL3026 ignore that is not directly above a FROM of an upstream lock base, with the book edit and
 * P1.27s named in the comment line above it, and every upstream FROM without one.
 */
function dl3026Problems(dockerfile: string, lock: Lock): string[] {
  const lines = dockerfile.split("\n").map((line) => line.trim());
  const ignores = lines.flatMap((line, at) => (/hadolint\b.*ignore/i.test(line) ? [at] : []));
  const upstream = Object.values(lock).filter((base) => base.source === "upstream");
  const upstreamFroms = fromImages(dockerfile).filter((image) =>
    upstream.some((base) => PINNED.exec(image)?.[1] === base.ref),
  );
  const problems =
    ignores.length === upstreamFroms.length
      ? []
      : [`${ignores.length} ignores for ${upstreamFroms.length} upstream FROMs`];
  for (const at of ignores) {
    // hadolint applies an inline ignore to the next line only (src/Hadolint/Pragma.hs, `line + 1`, v2.15.1), so the
    // FROM follows the ignore directly and the reason sits in the comment line above it.
    const from = lines[at + 1] ?? "";
    const ref = PINNED.exec(FROM.exec(from)?.[1] ?? "")?.[1];
    if (lines[at] !== "# hadolint ignore=DL3026") problems.push(`line ${at + 1} is not a DL3026 ignore`);
    if (!/^# .*2026-10-06-p127-upstream-base-by-digest.*removed by P1\.27s/.test(lines[at - 1] ?? "")) {
      problems.push(`line ${at + 1} has no reason above it`);
    }
    if (!upstream.some((base) => base.ref === ref)) problems.push(`line ${at + 1} is not above an upstream FROM`);
  }
  return problems;
}

/** The paths an `rm -rf` deletes in the final stage: every word after `rm -rf` in a RUN, up to `&&` or `;`. */
function finalStageRemovals(dockerfile: string): Set<string> {
  const all = instructions(dockerfile);
  const finalFromAt = all.findLastIndex((step) => /^FROM\s/i.test(step.text));
  const removed = new Set<string>();
  for (const { text } of all.slice(finalFromAt + 1)) {
    if (!/^RUN\s/i.test(text)) continue;
    for (const command of text.replace(/^RUN\s+/i, "").split(/&&|;/)) {
      const [rm, flags, ...paths] = command.trim().split(/\s+/);
      if (rm === "rm" && flags === "-rf") for (const path of paths) removed.add(path);
    }
  }
  return removed;
}

type Instruction = { line: number; text: string };

/** The instructions that become the image: the final stage's, after those of each stage it builds on by name. */
function shippedInstructions(all: Instruction[]): Instruction[] {
  const declared: { from: string; alias: string | undefined; body: Instruction[] }[] = [];
  for (const step of all) {
    const from = FROM.exec(step.text);
    if (from !== null) declared.push({ from: (from[1] ?? "").toLowerCase(), alias: from[2]?.toLowerCase(), body: [] });
    else declared.at(-1)?.body.push(step);
  }
  const shipped: Instruction[] = [];
  for (let at = declared.length - 1; at >= 0; ) {
    const stage = declared[at] as (typeof declared)[number];
    shipped.unshift(...stage.body);
    at = declared.findLastIndex((earlier, index) => index < at && earlier.alias === stage.from);
  }
  return shipped;
}

/**
 * The only verbs a shipped image may run a package manager with (architecture record
 * 2026-10-07-p129-migrate-image-and-run-only-images, amendment 3): removal. A list of install verbs could be dodged by
 * flag order, a full path or a synonym, so anything that is not removal fails, no verb included.
 */
const REMOVAL_VERBS = new Map<string, readonly string[]>([
  ["apk", ["del"]],
  ["apt", ["remove", "purge", "autoremove"]],
  ["apt-get", ["remove", "purge", "autoremove"]],
  ["dpkg", ["-r", "-P", "--remove", "--purge"]],
  ...["aptitude", "rpm", "dnf", "microdnf", "yum"].map((tool): [string, readonly string[]] => [tool, []]),
]);
/**
 * Amendment 5, layer 3: the value-less options a removal may carry, so no option (`-c`, `-o`, `--config-file`) can
 * hide the verb. After the verb only these options and package names may follow.
 */
const APT_FLAGS = ["-y", "-q", "--purge", "--auto-remove", "--no-install-recommends"];
const REMOVAL_FLAGS = new Map<string, readonly string[]>([
  ["apk", ["--no-network", "--purge", "--no-cache", "-q"]],
  ["apt", APT_FLAGS],
  // P1.29n: the node runtime purges apt, then debconf, dpkg and libapt, apt and dpkg essential (node-app.Dockerfile:47-48 and
  // migrate.Dockerfile:32-33); each kind's image test proves the result.
  ["apt-get", [...APT_FLAGS, "--allow-remove-essential"]],
  ["dpkg", ["--force-remove-essential", "--force-depends"]],
]);
const PACKAGE_NAME = /^[a-z0-9][a-z0-9+._-]*$/;
/**
 * Amendment 5, layer 2: every command a shipped stage runs, other than a package manager's removal, is one of these,
 * exactly what today's final stages use (rm in images/node-app.Dockerfile and images/migrate.Dockerfile; setcap and
 * rm in edge/Dockerfile). Every shell, interpreter and launcher fails without being named; a new command is added here
 * in a product PR that says so.
 */
const FINAL_STAGE_COMMANDS = new Set(["rm", "setcap"]);
/**
 * Amendment 5, layer 1, main's old check on joined instructions: a package-manager name between word boundaries, so a
 * hyphen ends a word and `apk-tools` or `apk-static` names apk (ruling under amendment 5, 22:57Z, point 1). A match is
 * exempt only as the first word of a command that passes layer 3, or as a package name after that command's removal
 * verb; every other match fails.
 */
const PACKAGE_MANAGER_WORD = /\b(?:apt-get|aptitude|apt|apk|dpkg|rpm|dnf|microdnf|yum)\b/g;
const FLOOR = "a package manager is named outside a removal command";

/** Why a package manager's command is not a plain removal (layer 3); undefined when it is one. */
function removalProblem(name: string, args: string[]): string | undefined {
  const verbs = REMOVAL_VERBS.get(name) ?? [];
  if (verbs.length === 0) return `${name} may not run in a shipped image`;
  const flags = REMOVAL_FLAGS.get(name) ?? [];
  const at = args.findIndex((word) => !flags.includes(word));
  const verb = args[at];
  if (verb === undefined || !verbs.includes(verb)) {
    return verb?.startsWith("-") ? `${name} option ${verb} is not allowed` : `${name} may only remove packages`;
  }
  const packages = args.slice(at + 1).filter((word) => !flags.includes(word));
  // Amendment 6, step A a: apt reads a trailing `+` as install, and `=` pins a version to install.
  const install = name.startsWith("apt")
    ? packages.find((word) => word.endsWith("+") || word.includes("="))
    : undefined;
  if (install !== undefined) return `${name} argument ${install} asks apt to install`;
  const other = packages.find((word) => !PACKAGE_NAME.test(word));
  return other === undefined ? undefined : `${name} argument ${other} is not a package name`;
}

/** One word of a RUN command: as written, and with quotes and backslashes dropped. */
type Token = { raw: string; word: string };
/** Amendment 6, step A e: a command is named bare, never by a path or a quoted or escaped spelling. */
const BARE_NAME = /^[a-z][a-z0-9-]*$/;
/** Amendment 6, step A e: the only setcap calls each kind's shipped stages make, argument for argument. */
const SETCAP_BY_KIND = new Map<Kind, readonly (readonly string[])[]>([
  ["edge", [["cap_net_bind_service=+ep", "/usr/bin/caddy"]]], // edge/Dockerfile:26
  ["node", []],
]);

/**
 * The only rm each kind's final stage runs that names a package manager, word for word as written (fourth
 * architecture note under amendment 7): the node kind drops dpkg's maintainer scripts once dpkg is gone
 * (node-app.Dockerfile:49-50, migrate.Dockerfile:34-35). Any other rm naming one, and this one in a stage the final
 * stage is built FROM (P1.29g), still meets the floor.
 */
const RM_BY_KIND = new Map<Kind, readonly (readonly string[])[]>([
  ["edge", []],
  [
    "node",
    [
      [
        "-f",
        "/var/lib/dpkg/info/*.preinst",
        "/var/lib/dpkg/info/*.postinst",
        "/var/lib/dpkg/info/*.prerm",
        "/var/lib/dpkg/info/*.postrm",
        "/var/lib/dpkg/info/*.config",
      ],
    ],
  ],
]);
const GLOB = /[*?[{]/;
/**
 * The only glob words each kind's final stage runs, word for word as written (P1.29g, record
 * 2026-10-08-p129f-corpus-gaps item 6), so no spelling hides a package manager's name from the floor: node's yarn
 * removal (node-app.Dockerfile:44, migrate.Dockerfile:29) and its maintainer-script rm (RM_BY_KIND).
 */
const GLOBS_BY_KIND = new Map<Kind, readonly string[]>([
  ["edge", []],
  ["node", ["/opt/yarn-*", ...(RM_BY_KIND.get("node")?.[0]?.filter((word) => GLOB.test(word)) ?? [])]],
]);

/** Why a command's glob words may not run in this shipped stage; undefined when it has none off the kind's list. */
function globProblem(command: Token[], kind: Kind | undefined, final: boolean): string | undefined {
  const listed = final ? (GLOBS_BY_KIND.get(kind as Kind) ?? []) : [];
  const glob = command.find(({ raw }) => GLOB.test(raw) && !listed.includes(raw));
  if (glob === undefined) return undefined;
  return `${command.map((token) => token.word).join(" ")}: ${glob.raw} is a glob not on the ${kind ?? "unknown"} list`;
}
const listedRm = (command: Token[], kind: Kind | undefined, final: boolean): boolean =>
  final &&
  command[0]?.raw === "rm" &&
  (RM_BY_KIND.get(kind as Kind) ?? []).some((allowed) =>
    isDeepStrictEqual(
      allowed,
      command.slice(1).map((token) => token.raw),
    ),
  );

/** Why one simple command may not run in a shipped image of this kind (layers 2 and 3); undefined when it may. */
function commandProblem(command: Token[], kind: Kind | undefined): string | undefined {
  const words = command.map((token) => token.word);
  const [first = { raw: "", word: "" }] = command;
  const [name = "", ...args] = words;
  const shown = words.join(" ");
  if (words.some((word) => /[$`]/.test(word))) return `${shown}: a variable or command substitution hides what runs`;
  if (/^\w+=/.test(name)) return `${shown}: a leading assignment changes how the command runs`;
  if (!BARE_NAME.test(first.raw)) return `${shown}: ${first.raw} is not a bare command name`;
  if (REMOVAL_VERBS.has(name)) {
    const problem = removalProblem(name, args);
    return problem === undefined ? undefined : `${shown}: ${problem}`;
  }
  if (name === "setcap") {
    const listed = (SETCAP_BY_KIND.get(kind as Kind) ?? []).some((allowed) => isDeepStrictEqual(allowed, args));
    return listed ? undefined : `${shown}: setcap arguments are not on the ${kind ?? "unknown"} list`;
  }
  return FINAL_STAGE_COMMANDS.has(name) ? undefined : `${shown}: ${name} is not an allowed final-stage command`;
}

const managerNames = (text: string): number => text.match(PACKAGE_MANAGER_WORD)?.length ?? 0;

/**
 * Layer 1 by position (amendment 6, step A c): the package-manager names in a command's words, other than its first
 * word and its package names when the command is a removal that passes, and none in a kind's listed rm. A word counts
 * as written and without quotes.
 */
function unexemptManagerNames(command: Token[], kind: Kind | undefined, final: boolean): number {
  if (listedRm(command, kind, final)) return 0;
  const [name = "", ...args] = command.map((token) => token.word);
  const flags = REMOVAL_FLAGS.get(name) ?? [];
  const removal = REMOVAL_VERBS.has(name) && commandProblem(command, kind) === undefined;
  const verbAt = args.findIndex((word) => !flags.includes(word)) + 1;
  return command.reduce((sum, { raw, word }, at) => {
    const exempt = removal && (at === 0 || (at > verbAt && !flags.includes(word)));
    return exempt ? sum : sum + Math.max(managerNames(raw), managerNames(word));
  }, 0);
}

/**
 * A shell-form RUN as simple commands: split on `&&`, `||`, `;`, `|`, `&` and newlines. A subshell or group keeps its
 * `(` or `{` on the first word, so it is no bare command name.
 */
function shellCommands(script: string): Token[][] {
  return script
    .split(/&&|\|\||[;|&\n]/)
    .map((command) =>
      command
        .trim()
        .split(/\s+/)
        .map((raw) => ({ raw, word: raw.replaceAll(/["'\\]/g, "") }))
        .filter((token) => token.word !== ""),
    )
    .filter((command) => command.length > 0);
}

/** An exec-form RUN is one command, its JSON array of strings; undefined when it is not one. */
function execCommand(json: string): string[] | undefined {
  try {
    const words: unknown = JSON.parse(json);
    return Array.isArray(words) && words.every((word) => typeof word === "string") ? words : undefined;
  } catch {
    return undefined;
  }
}

/**
 * P1.29f (architecture note under amendment 7, after #535): a shipped shell RUN joins its commands with `&&` only, so a
 * failed removal fails the build. `;`, `||`, `|`, a lone `&` and `#` all let a removal fail or vanish unseen.
 */
const SEPARATOR = /[;|&#]/;

/** Why a RUN's text cannot be read as commands: a substitution, or exec form that is not a string array. */
function unreadableRun(rest: string): string | undefined {
  if (rest.startsWith("[")) return execCommand(rest) === undefined ? "cannot parse exec-form RUN" : undefined;
  if (SEPARATOR.test(rest.replaceAll("&&", ""))) return "a shell RUN joins commands with && only";
  if (/[$`]/.test(rest)) return "a variable or command substitution hides what runs";
  return /[<>]\(/.test(rest) ? "a process substitution hides what runs" : undefined;
}

/** Why one shipped instruction may install OS packages; SHELL is refused because it changes what every RUN runs. */
function shippedInstructionProblems(instruction: string, kind: Kind | undefined, final: boolean): string[] {
  const [, word = "", args = ""] = INSTRUCTION.exec(instruction) ?? [];
  const keyword = word.toUpperCase();
  if (keyword === "ONBUILD") return ["ONBUILD is not allowed"];
  if (keyword === "SHELL") return ["SHELL changes what RUN runs"];
  if (keyword !== "RUN") return [];
  const { flags, rest } = splitFlags(args);
  const problems = flags.some((flag) => flag.startsWith("--mount"))
    ? ["RUN --mount may not run in a shipped stage"]
    : [];
  const unreadable = unreadableRun(rest);
  if (unreadable !== undefined) return [...problems, unreadable];
  const exec = rest.startsWith("[") ? execCommand(rest) : undefined;
  const commands = exec === undefined ? shellCommands(rest) : [exec.map((word) => ({ raw: word, word }))];
  for (const command of commands) {
    // Exec form runs no shell, so it expands no glob.
    const glob = exec === undefined ? globProblem(command, kind, final) : undefined;
    for (const problem of [commandProblem(command, kind), glob]) {
      if (problem !== undefined) problems.push(problem);
    }
  }
  // Layer 1 reads the flags too (amendment 6, step A b); nothing in them is exempt.
  const named =
    managerNames(flags.join(" ")) + commands.reduce((sum, c) => sum + unexemptManagerNames(c, kind, final), 0);
  return named > 0 ? [...problems, FLOOR] : problems;
}

/**
 * P1.29f (amendment 7 point 2): a COPY or ADD destination and a WORKDIR are absolute paths of plain characters, so no
 * quote, escape, variable or relative step can move where a file lands. JSON-form destinations are read decoded.
 */
const PLAIN_PATH = /^\/[A-Za-z0-9._/-]+$/;
/**
 * P1.29f (amendment 7 point 3): where each kind's shipped stages may copy, exactly; a prefix ending in `/` covers its
 * tree. Anything else fails, which keeps amendment 6's PATH directories, package-manager state, loader configuration
 * and maintainer scripts (`/var/lib/dpkg/info`) out without listing them.
 */
const DESTINATIONS_BY_KIND = new Map<Kind, readonly string[]>([
  ["edge", ["/usr/bin/caddy", "/etc/caddy/"]], // edge/Dockerfile:23 and :30-32
  ["node", ["/app/"]], // node-app.Dockerfile:32-37, migrate.Dockerfile:21-26
]);

/** Why one shipped COPY or ADD destination may not be written; undefined when it is on the kind's list. */
function destinationProblem(destination: string, kind: Kind | undefined): string | undefined {
  if (!PLAIN_PATH.test(destination)) return `destination ${destination} is not an absolute plain path`;
  const target = posix.normalize(destination);
  const listed = (DESTINATIONS_BY_KIND.get(kind as Kind) ?? []).some((prefix) =>
    prefix.endsWith("/") ? target.startsWith(prefix) : target === prefix,
  );
  return listed ? undefined : `copies into ${target}, not on the ${kind ?? "unknown"} list`;
}

/** A --chmod value BuildKit reads as octal, at most 07777, or else as a symbolic mode (convert_copy.go:68-87). */
const OCTAL_MODE = /^[0-7]+$/;
const SYMBOLIC_MODE = /^[ugoa]*(?:[-+=][rwxXst]*)+(?:,[ugoa]*(?:[-+=][rwxXst]*)+)*$/;

/**
 * Why a COPY or ADD's --chmod may ship a privilege (P1.29p, record 2026-10-08-p129f-corpus-gaps): a setuid, setgid or
 * sticky bit, or a value that is not plain octal or symbolic, a variable included. BuildKit's own parse is in
 * moby/buildkit frontend/dockerfile/dockerfile2llb/convert_copy.go:68-87 (master, read 2026-10-08).
 */
function chmodProblem(flags: readonly string[]): string | undefined {
  for (const flag of flags.filter((word) => /^--chmod(?:=|$)/.test(word))) {
    const mode = flag.slice("--chmod=".length);
    const octal = OCTAL_MODE.test(mode) ? Number.parseInt(mode, 8) : undefined;
    if (octal === undefined ? !SYMBOLIC_MODE.test(mode) : octal > 0o7777) {
      return `--chmod=${mode} is not a plain octal or symbolic mode`;
    }
    if (octal === undefined ? /[st]/.test(mode) : (octal & 0o7000) !== 0) {
      return `--chmod=${mode} sets a setuid, setgid or sticky bit`;
    }
  }
  return undefined;
}

/** Why one COPY or ADD may not run in a shipped stage; its destination is the last word, decoded in JSON form. */
function copyProblem(keyword: string, args: string, kind: Kind | undefined): string | undefined {
  const { flags, rest } = splitFlags(args);
  const chmod = chmodProblem(flags);
  if (chmod !== undefined) return chmod;
  const words = rest.startsWith("[") ? execCommand(rest) : rest.split(/\s+/);
  const destination = words?.at(-1);
  if (destination === undefined || words === undefined || words.length < 2) return `cannot parse ${keyword}`;
  return destinationProblem(destination, kind);
}

/** Every shipped COPY, ADD or WORKDIR that may land somewhere its kind does not list (P1.29f points 2 and 3). */
function copyDestinationProblems(dockerfile: string): string[] {
  const kind = kindOf(dockerfile, lock);
  const problems: string[] = [];
  for (const { line, text } of shippedInstructions(instructions(dockerfile))) {
    const [, word = "", args = ""] = INSTRUCTION.exec(text) ?? [];
    const keyword = word.toUpperCase();
    const problem =
      keyword === "WORKDIR"
        ? PLAIN_PATH.test(args.trim())
          ? undefined
          : `WORKDIR ${args.trim()} is not an absolute plain path`
        : keyword === "COPY" || keyword === "ADD"
          ? copyProblem(keyword, args, kind)
          : undefined;
    if (problem !== undefined) problems.push(`line ${line}: ${problem}`);
  }
  return problems;
}

/**
 * P1.29f (amendment 7 point 3): the ENV keys each kind's shipped stages set, exactly. No kind sets PATH, so PATH is on
 * no list; a kind that needs it lists its exact value. `LD_*`, `NODE_OPTIONS`, `BASH_ENV` and `ENV` change what every
 * process loads or runs and are on no list either.
 */
const ENV_KEYS_BY_KIND = new Map<Kind, readonly string[]>([
  ["edge", []],
  ["node", ["NODE_ENV"]], // node-app.Dockerfile:30, migrate.Dockerfile:19
]);
const ENV_PAIR = /^([A-Za-z_][A-Za-z0-9_]*)=\S*$/;

/** Every shipped ENV key the kind does not list, every ENV in another form, and every shipped ARG. */
function environmentProblems(dockerfile: string): string[] {
  const kind = kindOf(dockerfile, lock);
  const listed = ENV_KEYS_BY_KIND.get(kind as Kind) ?? [];
  return shippedInstructions(instructions(dockerfile)).flatMap(({ line, text }) => {
    const [, word = "", args = ""] = INSTRUCTION.exec(text) ?? [];
    const keyword = word.toUpperCase();
    if (keyword === "ARG") return [`line ${line}: ARG is not allowed in a shipped stage`];
    if (keyword !== "ENV") return [];
    const pairs = args.trim().split(/\s+/);
    if (!pairs.every((pair) => ENV_PAIR.test(pair))) return [`line ${line}: cannot parse ENV ${args.trim()}`];
    return pairs
      .map((pair) => pair.slice(0, pair.indexOf("=")))
      .filter((key) => !listed.includes(key))
      .map((key) => `line ${line}: ENV ${key} is not on the ${kind ?? "unknown"} list`);
  });
}

/** Every ONBUILD in a Dockerfile, in any stage. */
function onbuildProblems(dockerfile: string): string[] {
  return instructions(dockerfile)
    .filter(({ text }) => INSTRUCTION.exec(text)?.[1]?.toUpperCase() === "ONBUILD")
    .map(({ line }) => `line ${line}: ONBUILD is not allowed`);
}

/** The simple commands every shipped RUN runs, in order, in shell or exec form. */
function shippedCommands(dockerfile: string): string[][] {
  return shippedInstructions(instructions(dockerfile)).flatMap(({ text }) => {
    const [, word = "", args = ""] = INSTRUCTION.exec(text) ?? [];
    if (word.toUpperCase() !== "RUN") return [];
    const { rest } = splitFlags(args);
    const exec = rest.startsWith("[") ? execCommand(rest) : undefined;
    return exec === undefined ? shellCommands(rest).map((command) => command.map((token) => token.word)) : [exec];
  });
}

/**
 * The edge kind's package-manager rule (P1.28y; P1.28o record, architecture amendment 22:45Z, "Afterwards"): its
 * Caddy Alpine base ships apk, so the last apk command the image runs must be a removal of apk-tools itself.
 */
function apkKeptProblems(dockerfile: string): string[] {
  const last = shippedCommands(dockerfile)
    .filter((words) => (words[0] ?? "").split("/").at(-1) === "apk")
    .at(-1);
  const removesApk =
    last !== undefined && removalProblem("apk", last.slice(1)) === undefined && last.includes("apk-tools");
  return removesApk ? [] : ["the final stage keeps apk: its last apk command does not remove apk-tools"];
}

/** Every way the shipped stages install OS packages (amendment 3); build stages may, being scanned and never shipped. */
function osPackageProblems(dockerfile: string): string[] {
  try {
    const kind = kindOf(dockerfile, lock);
    const all = instructions(dockerfile);
    const finalFrom = all.findLast(({ text }) => FROM.test(text))?.line ?? 0;
    return shippedInstructions(all).flatMap(({ line, text }) =>
      shippedInstructionProblems(text, kind, line > finalFrom).map((problem) => `line ${line}: ${problem}`),
    );
  } catch (error) {
    if (!(error instanceof Unparsed)) throw error;
    return [`line ${error.line}: ${error.message}`];
  }
}

const STRIPPED_PATH = /^\/[\w.@+-]+(?:\/[\w.@+-]+)*$/;

/** Every way a lock entry's `stripped` list is malformed: empty, a path twice, or a path not absolute and literal. */
function strippedListProblems(name: string, declared: string[]): string[] {
  const problems = declared.length === 0 ? [`lock entry ${name} has an empty stripped list`] : [];
  if (new Set(declared).size !== declared.length) problems.push(`lock entry ${name} lists a stripped path twice`);
  for (const path of declared) {
    if (!STRIPPED_PATH.test(path) || path.split("/").includes("..")) {
      problems.push(`lock entry ${name}: stripped path ${path} is not an absolute path without wildcards`);
    }
  }
  return problems;
}

/**
 * Every stripped path a lock entry declares that is malformed, or that an image built on that base keeps: each
 * Dockerfile whose final stage builds on the entry must delete each declared path with `rm -rf` in that stage, and a
 * path is declared only when at least one final stage builds on the entry (P1.29x).
 */
function strippedProblems(files: Record<string, string>, lock: Lock): string[] {
  const problems: string[] = [];
  for (const [name, { stripped }] of Object.entries(lock)) {
    if (stripped === undefined) continue;
    problems.push(...strippedListProblems(name, stripped));
    const users = Object.entries(files).filter(([, text]) => finalEntry(text, lock) === name);
    if (users.length === 0) problems.push(`lock entry ${name} declares stripped paths but no final stage builds on it`);
    for (const [file, text] of users) {
      const removed = finalStageRemovals(text);
      const kept = stripped.filter((path) => !removed.has(path));
      problems.push(...kept.map((path) => `${file} keeps ${path}, which lock entry ${name} declares stripped`));
    }
  }
  return problems.sort();
}

/** Every Dockerfile under deployment/ (the web image's and, from P1.28, the edge's), so a new image is covered too. */
const dockerfiles = (readdirSync(DEPLOYMENT, { recursive: true }) as string[])
  .filter((file) => /(^|\/)([\w.-]+\.)?Dockerfile$/.test(file) && !file.includes("node_modules"))
  .sort();

const dockerfile = read(DOCKERFILE);
const lock = JSON.parse(read("images/bases.lock.json")) as Lock;
const NODE = lock.node as Base;
/**
 * The images whose final stage builds on the locked Node base, found from `dockerfiles` rather than listed, so a new
 * Node image is held to the Node runtime rules below without editing this test.
 */
const nodeDockerfiles = dockerfiles.filter((file) => kindOf(read(file), lock) === "node");
const edgeDockerfiles = dockerfiles.filter((file) => kindOf(read(file), lock) === "edge");
const pinnedNode = `docker.io/library/node:${NODE.tag}@${NODE.digest}`;

describe("base images", () => {
  test("base_digest_matches_lock", () => {
    for (const file of dockerfiles) {
      expect(baseProblems(read(file), lock), file).toEqual([]);
      expect(fromImages(read(file)).length, file).toBeGreaterThanOrEqual(2);
    }
    const other = `sha256:${"1".repeat(64)}`;
    expect(baseProblems(`FROM docker.io/library/node:${NODE.tag}@${other} AS build`, lock)).toEqual([
      `FROM docker.io/library/node:${NODE.tag}@${other} matches no lock entry by tag and digest`,
    ]);
    // Amendment 4: a FROM matches its entry on ref, tag and digest, so the runtime digest under the builder's tag (or
    // no tag) is no entry at all.
    const runtime = lock.caddy as Base;
    const builder = lock["caddy-builder"] as Base;
    for (const image of [`${runtime.ref}:${builder.tag}@${runtime.digest}`, `${runtime.ref}@${runtime.digest}`]) {
      expect(baseProblems(`FROM ${image}`, lock), image).toEqual([
        `FROM ${image} matches no lock entry by tag and digest`,
      ]);
    }
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
      stripped: ["/usr/local/lib/node_modules/npm", "/usr/local/lib/node_modules/corepack"],
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

  test("stripped_paths_removed_in_every_final_stage", () => {
    const files = Object.fromEntries(dockerfiles.map((file) => [file, read(file)]));
    expect(strippedProblems(files, lock)).toEqual([]);
    const npm = "/usr/local/lib/node_modules/npm";
    const corepack = "/usr/local/lib/node_modules/corepack";
    const declared: Lock = { node: { ...NODE, stripped: [npm, corepack] } };
    const both = `RUN rm -rf ${npm} \\\n  ${corepack}\n`;
    expect(strippedProblems({ ok: `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n${both}` }, declared)).toEqual([]);
    expect(
      strippedProblems(
        {
          "one.Dockerfile": `FROM ${pinnedNode}\nRUN rm -rf ${npm}\n`,
          "early.Dockerfile": `FROM ${pinnedNode} AS deps\n${both}FROM ${pinnedNode}\n`,
          "chained.Dockerfile": `FROM ${pinnedNode} AS base\nFROM base\nRUN true && rm -rf ${npm} && rm -f ${corepack}\n`,
        },
        declared,
      ),
    ).toEqual([
      `chained.Dockerfile keeps ${corepack}, which lock entry node declares stripped`,
      `early.Dockerfile keeps ${corepack}, which lock entry node declares stripped`,
      `early.Dockerfile keeps ${npm}, which lock entry node declares stripped`,
      `one.Dockerfile keeps ${corepack}, which lock entry node declares stripped`,
    ]);
    expect(strippedProblems({}, declared)).toEqual([
      "lock entry node declares stripped paths but no final stage builds on it",
    ]);
    expect(
      strippedProblems(
        { ok: `FROM ${pinnedNode}\n` },
        { node: { ...NODE, stripped: ["/opt/yarn-*", "usr/x", "/a/../b"] } },
      ),
    ).toEqual([
      "lock entry node: stripped path /a/../b is not an absolute path without wildcards",
      "lock entry node: stripped path /opt/yarn-* is not an absolute path without wildcards",
      "lock entry node: stripped path usr/x is not an absolute path without wildcards",
      "ok keeps /a/../b, which lock entry node declares stripped",
      "ok keeps /opt/yarn-*, which lock entry node declares stripped",
      "ok keeps usr/x, which lock entry node declares stripped",
    ]);
    expect(strippedProblems({ ok: `FROM ${pinnedNode}\n` }, { node: { ...NODE, stripped: [] } })).toEqual([
      "lock entry node has an empty stripped list",
    ]);
    expect(
      strippedProblems({ ok: `FROM ${pinnedNode}\n${both}` }, { node: { ...NODE, stripped: [npm, npm] } }),
    ).toEqual(["lock entry node lists a stripped path twice"]);
  });

  test("every_dockerfile_has_a_known_kind", () => {
    const files = Object.fromEntries(dockerfiles.map((file) => [file, read(file)]));
    expect(kindProblems(files, lock)).toEqual([]);
    expect(kindOf(read("edge/Dockerfile"), lock)).toBe("edge");
    const builder = lock["caddy-builder"] as Base;
    const build = `${builder.ref}:${builder.tag}@${builder.digest}`;
    // A runtime entry outside the map (here a Postgres base before P1.29d adds it) fails, as do scratch and a build base.
    const postgres: Base = { ...NODE, ref: "docker.io/library/postgres", tag: "18-trixie" };
    const pinnedPostgres = `${postgres.ref}:${postgres.tag}@${postgres.digest}`;
    expect(
      kindProblems(
        {
          "pg.Dockerfile": `FROM ${pinnedPostgres}`,
          "scratch.Dockerfile": "FROM scratch",
          "b.Dockerfile": `FROM ${build}`,
        },
        { ...lock, postgres },
      ),
    ).toEqual([
      "pg.Dockerfile builds on no known kind of image",
      "scratch.Dockerfile builds on no known kind of image",
      "b.Dockerfile builds on no known kind of image",
    ]);
  });

  test("node_kind_includes_current_images", () => {
    // A floor, not an exact list: a new Dockerfile on the Node base joins the set without editing this test.
    expect(nodeDockerfiles).toEqual(expect.arrayContaining([DOCKERFILE, MIGRATE_DOCKERFILE]));
    expect(nodeDockerfiles).not.toContain("edge/Dockerfile");
  });

  test("shared_ref_entries_agree", () => {
    expect(sharedRefProblems(lock)).toEqual([]);
    const runtime = lock.caddy as Base;
    // One image listed as both a build and a runtime base is fine while the two agree on everything else.
    expect(sharedRefProblems({ a: runtime, b: { ...runtime, stage: "build" } })).toEqual([]);
    expect(sharedRefProblems({ a: runtime, b: { ...runtime, stage: "build", source: "mirror" } })).toEqual([
      "lock entries a and b name one image but differ",
    ]);
    expect(sharedRefProblems({ a: runtime, b: { ...runtime, tag: "other" } })).toEqual([
      "lock entries a and b name one image but differ",
    ]);
    expect(sharedRefProblems({ a: runtime, b: { ...runtime, digest: `sha256:${"1".repeat(64)}` } })).toEqual([
      `lock entries a and b give ${runtime.ref}:${runtime.tag} two digests`,
    ]);
  });

  test("runtime_base_is_debian_slim", () => {
    // Alex, 2026-10-07 01:29:53Z, "Debian slim" (P1.27d): the web image runs on Debian trixie slim. Every stage uses the
    // one locked base.
    expect(NODE.ref).toBe("docker.io/library/node");
    expect(NODE.tag).toMatch(/^26(?:\.\d+){0,2}-[a-z]+-slim$/);
    for (const file of nodeDockerfiles) {
      for (const image of fromImages(read(file))) expect(image, file).toBe(pinnedNode);
    }
  });

  test("runtime_stage_installs_no_os_packages", () => {
    // Amendments 3 and 5: in the stages an image ships, read on joined instructions, a package manager may only remove
    // (layer 3), every command is on an allowlist (layer 2), and a package-manager name anywhere else fails (layer 1).
    for (const file of dockerfiles) expect(osPackageProblems(read(file)), file).toEqual([]);
    const node = `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n`;
    const substitution = "a variable or command substitution hides what runs";
    const floor = "a package manager is named outside a removal command";
    const notAllowed = (shown: string, name: string): string =>
      `${shown}: ${name} is not an allowed final-stage command`;
    const notBare = (shown: string, word: string): string => `${shown}: ${word} is not a bare command name`;
    const assignment = (shown: string): string => `${shown}: a leading assignment changes how the command runs`;
    const setcapNotListed = (shown: string, kind: string): string =>
      `${shown}: setcap arguments are not on the ${kind} list`;
    const mount = "RUN --mount may not run in a shipped stage";
    const processSubstitution = "a process substitution hides what runs";
    const execSync = "require('child_process').execSync('apt-get install -y curl')";
    const execFileSync = "require('child_process').execFileSync('apt-get', ['install', 'curl'])";
    const perl = "system('apt-get install -y curl')";
    for (const [run, problems] of [
      // Amendment 5's red fixtures: the verifier's four, ksh, a name the floor cannot see, -o, an exec-form argument.
      [`RUN ["node","-e","${execSync}"]`, [notAllowed(`node -e ${execSync}`, "node"), floor]],
      [`RUN ["perl","-e","${perl}"]`, [notAllowed(`perl -e ${perl}`, "perl"), floor]],
      [
        `RUN ["node","-e","${execFileSync.replaceAll("'", "\\u0027")}"]`,
        [notAllowed(`node -e ${execFileSync}`, "node"), floor],
      ],
      [
        "RUN apt-get -c remove install -y curl",
        ["apt-get -c remove install -y curl: apt-get option -c is not allowed", floor],
      ],
      ["RUN ksh -c 'apk add x'", [notAllowed("ksh -c apk add x", "ksh"), floor]],
      [
        `RUN node -e "require('child_process').execSync('ap'+'t-get install x')"`,
        [notAllowed("node -e require(child_process).execSync(ap+t-get install x)", "node")],
      ],
      [
        "RUN apt-get -o Foo=remove install x",
        ["apt-get -o Foo=remove install x: apt-get option -o is not allowed", floor],
      ],
      ['RUN ["rm","-f","/usr/bin/apt-get"]', [floor]],
      // Ruling point 1: a hyphen ends a word, so a name joined to one is still found.
      ["RUN apk-static add x", [notAllowed("apk-static add x", "apk-static"), floor]],
      ["RUN /sbin/apk-static add x", [notBare("/sbin/apk-static add x", "/sbin/apk-static"), floor]],
      ["RUN rm -f /etc/apk-tools.conf", [floor]],
      ["RUN FOO=apk rm -f /x", [assignment("FOO=apk rm -f /x"), floor]],
      ['RUN a"pk" del --no-network x && rm -f /sbin/apk', [notBare("apk del --no-network x", 'a"pk"'), floor]],
      // Amendment 6, step A: the coordinator's four gaps.
      ["RUN apt-get remove -y curl+", ["apt-get remove -y curl+: apt-get argument curl+ asks apt to install", floor]],
      [
        'RUN ["apt-get","remove","-y","curl+"]',
        ["apt-get remove -y curl+: apt-get argument curl+ asks apt to install", floor],
      ],
      ["RUN apt purge x+", ["apt purge x+: apt argument x+ asks apt to install", floor]],
      ["RUN apt-get autoremove x+", ["apt-get autoremove x+: apt-get argument x+ asks apt to install", floor]],
      [
        "RUN apt-get remove -y curl=1.0",
        ["apt-get remove -y curl=1.0: apt-get argument curl=1.0 asks apt to install", floor],
      ],
      ["RUN --mount=type=bind,source=/usr/bin/apt-get,target=/usr/local/bin/rm rm install -y curl", [mount, floor]],
      ["RUN --mount=type=cache,target=/var/cache/x rm -f /x", [mount]],
      ["RUN --mount=type=cache,target=/x apk del x", [mount]],
      // P1.29n adds exactly two dpkg flags and one apt-get flag; others still fail.
      ["RUN dpkg --force-all -r x", ["dpkg --force-all -r x: dpkg option --force-all is not allowed", floor]],
      [
        "RUN apt purge --allow-remove-essential x",
        ["apt purge --allow-remove-essential x: apt argument --allow-remove-essential is not a package name", floor],
      ],
      ["RUN apt-get purge x=1.0", ["apt-get purge x=1.0: apt-get argument x=1.0 asks apt to install", floor]],
      ["RUN FOO=1 rm -f /x", [assignment("FOO=1 rm -f /x")]],
      ["RUN <<EOF\nrm -f /x\nEOF", ["heredoc not supported"]],
      ['RUN a"pk" del x && FOO=apk rm -f /x', [notBare("apk del x", 'a"pk"'), assignment("FOO=apk rm -f /x"), floor]],
      ["RUN (apk del x)", [notBare("(apk del x)", "(apk"), floor]],
      // Amendment 6, step A e: bare command names, no leading assignment, no process substitution.
      ["RUN /tmp/apk del x", [notBare("/tmp/apk del x", "/tmp/apk"), floor]],
      ["RUN ./rm -f /x", [notBare("./rm -f /x", "./rm")]],
      ["RUN /usr/local/bin/rm -f /x", [notBare("/usr/local/bin/rm -f /x", "/usr/local/bin/rm")]],
      ["RUN PATH=/tmp rm -f /x", [assignment("PATH=/tmp rm -f /x")]],
      ["RUN LD_PRELOAD=/x.so rm -f /x", [assignment("LD_PRELOAD=/x.so rm -f /x")]],
      ["RUN rm -f <(echo x)", [processSubstitution]],
      ["RUN rm -f >(cat)", [processSubstitution]],
      [
        "RUN setcap cap_net_bind_service=+ep /usr/bin/caddy",
        [setcapNotListed("setcap cap_net_bind_service=+ep /usr/bin/caddy", "node")],
      ],
      ["RUN dpkg -r x && rm -rf /usr/bin/dpkg", [floor]],
      // Amendment 3's fixtures.
      ["RUN rm -f /x \\\n  && apk add curl", ["apk add curl: apk may only remove packages", floor]],
      ["RUN apk --no-cache add curl", ["apk --no-cache add curl: apk may only remove packages", floor]],
      ["RUN /sbin/apk add curl", [notBare("/sbin/apk add curl", "/sbin/apk"), floor]],
      ["RUN apt-get -y install curl", ["apt-get -y install curl: apt-get may only remove packages", floor]],
      ["RUN apk fix", ["apk fix: apk may only remove packages", floor]],
      ["RUN dpkg --unpack x.deb", ["dpkg --unpack x.deb: dpkg option --unpack is not allowed", floor]],
      ['RUN sh -c "apk add x"', [notAllowed("sh -c apk add x", "sh"), floor]],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a Dockerfile variable, not a JS template.
      ["RUN ${PM} add x", [substitution]],
      ["RUN $PM add x", [substitution]],
      ['RUN ["apk","add","x"]', ["apk add x: apk may only remove packages", floor]],
      ["RUN nohup apk add x", [notAllowed("nohup apk add x", "nohup"), floor]],
      ["RUN FOO=1 apk add x", [assignment("FOO=1 apk add x"), floor]],
      ["RUN apk", ["apk: apk may only remove packages", floor]],
      ["RUN apk del --no-network x/y", ["apk del --no-network x/y: apk argument x/y is not a package name", floor]],
      ["RUN yum remove x", ["yum remove x: yum may not run in a shipped image", floor]],
      ["ONBUILD RUN apk add x", ["ONBUILD is not allowed"]],
      ['SHELL ["/sbin/apk", "add"]', ["SHELL changes what RUN runs"]],
    ] as const) {
      expect(osPackageProblems(`${node}${run}`), run).toEqual(problems.map((problem) => `line 3: ${problem}`));
    }
    // Stages the final one builds on by name ship too; a stage it only copies from does not.
    expect(osPackageProblems(`FROM ${pinnedNode} AS base\nRUN apk add x\nFROM base`)).toEqual([
      "line 2: apk add x: apk may only remove packages",
      `line 2: ${floor}`,
    ]);
    expect(osPackageProblems(`FROM ${pinnedNode} AS deps\nRUN apk add x\nFROM ${pinnedNode}`)).toEqual([]);
    // A build stage keeps RUN --mount.
    expect(
      osPackageProblems(`FROM ${pinnedNode} AS deps\nRUN --mount=type=cache,target=/x rm -f /x\nFROM ${pinnedNode}`),
    ).toEqual([]);
    const caddy = lock.caddy as Base;
    const edge = `FROM ${caddy.ref}:${caddy.tag}@${caddy.digest}\n`;
    expect(
      osPackageProblems(
        `${edge}RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \\\n    && apk del --no-network curl`,
      ),
    ).toEqual([]);
    expect(osPackageProblems(`${edge}RUN setcap cap_net_admin=+ep /usr/bin/caddy`)).toEqual([
      `line 2: ${setcapNotListed("setcap cap_net_admin=+ep /usr/bin/caddy", "edge")}`,
    ]);
    const scripts = ["preinst", "postinst", "prerm", "postrm", "config"]
      .map((suffix) => `/var/lib/dpkg/info/*.${suffix}`)
      .join(" ");
    // P1.29f (amendment 7 point 4): the pin for amendment 6 step A c. A count of exempt names rather than their
    // positions passes `rm -f /apk\\x` on the strength of the escaped package name; by position it is the one floor hit.
    expect(osPackageProblems(`${edge}RUN apk del ap\\k-tools && rm -f /apk\\x`)).toEqual([`line 2: ${floor}`]);
    // P1.29f (architecture note under amendment 7, after #535): `&&` is the only separator; #535's three spellings first.
    const separator = "a shell RUN joins commands with && only";
    for (const run of [
      "RUN rm -rf /usr/share/caddy || apk del --no-network apk-tools",
      "RUN rm -rf /usr/share/caddy # && apk del --no-network apk-tools",
      "RUN apk del --no-network apk-tools &",
      "RUN rm -f /x; apk del --no-network apk-tools",
      "RUN rm -f /x | apk del --no-network apk-tools",
      'RUN rm -f "/x;y"',
    ]) {
      expect(osPackageProblems(`${edge}${run}`), run).toEqual([`line 2: ${separator}`]);
    }
    for (const run of [
      "RUN apk del --no-network curl libcap apk-tools",
      "RUN apt-get purge -y x",
      "RUN dpkg -r x",
      // P1.29n's removal of the OS package managers.
      "RUN apt-get purge --allow-remove-essential -y apt \\\n  && dpkg --purge --force-remove-essential --force-depends debconf dpkg",
      `RUN rm -f ${scripts}`,
    ]) {
      expect(osPackageProblems(`${node}${run}`), run).toEqual([]);
    }
    // The node kind's listed rm passes word for word only, and only in a node image (fourth note under amendment 7).
    for (const [base, run] of [
      [node, `RUN rm -f ${scripts} /x`],
      [node, `RUN rm -rf ${scripts}`],
      [node, "RUN rm -f /var/lib/dpkg/status"],
    ] as const) {
      expect(osPackageProblems(`${base}${run}`), run).toEqual([`line ${base.split("\n").length}: ${floor}`]);
    }
    // The same two with their glob words off the list as well (P1.29g, item 6): quoted, and in an edge image.
    const quoted = scripts.replace("*.preinst", "'*.preinst'");
    expect(osPackageProblems(`${node}RUN rm -f ${quoted}`)).toEqual([
      `line 3: rm -f ${scripts}: /var/lib/dpkg/info/'*.preinst' is a glob not on the node list`,
      `line 3: ${floor}`,
    ]);
    expect(osPackageProblems(`${edge}RUN rm -f ${scripts}`)).toEqual([
      `line 2: rm -f ${scripts}: /var/lib/dpkg/info/*.preinst is a glob not on the edge list`,
      `line 2: ${floor}`,
    ]);
    // P1.29g: the listed rm and its globs pass in the final stage only, not in a stage the final stage is built FROM.
    expect(osPackageProblems(`FROM ${pinnedNode} AS base\nRUN rm -f ${scripts}\nFROM base`)).toEqual([
      `line 2: rm -f ${scripts}: /var/lib/dpkg/info/*.preinst is a glob not on the node list`,
      `line 2: ${floor}`,
    ]);
  });

  test("no_dockerfile_uses_onbuild", () => {
    // Coordinator, 23:39Z (a tightening): ONBUILD is refused outright, in every stage, so no instruction runs in a later
    // build that these rules never read.
    for (const file of dockerfiles) expect(onbuildProblems(read(file)), file).toEqual([]);
    expect(onbuildProblems(`FROM ${pinnedNode} AS deps\nONBUILD COPY x /x\nFROM ${pinnedNode}`)).toEqual([
      "line 2: ONBUILD is not allowed",
    ]);
    expect(onbuildProblems(`FROM ${pinnedNode}\nonbuild RUN rm -f /x`)).toEqual(["line 2: ONBUILD is not allowed"]);
  });

  test("shipped_copies_land_on_the_kind_list", () => {
    // P1.29f (amendment 7 points 2 and 3): a shipped COPY or ADD lands only under its kind's exact prefixes, at an
    // absolute plain path, and every shipped WORKDIR is one. This replaces amendment 6's PATH and package-state lists.
    for (const file of dockerfiles) expect(copyDestinationProblems(read(file)), file).toEqual([]);
    const caddy = lock.caddy as Base;
    const edge = `FROM ${caddy.ref}:${caddy.tag}@${caddy.digest}\n`;
    const node = `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n`;
    const listed = (target: string, kind = "node"): string => `copies into ${target}, not on the ${kind} list`;
    const plain = (destination: string): string => `destination ${destination} is not an absolute plain path`;
    const workdir = (path: string): string => `WORKDIR ${path} is not an absolute plain path`;
    for (const [base, copy, problems] of [
      [node, "COPY x /usr/bin/x", [`line 3: ${listed("/usr/bin/x")}`]],
      [node, "COPY --from=deps /app/x /usr/local/bin/", [`line 3: ${listed("/usr/local/bin/")}`]],
      [node, "ADD x /sbin/x", [`line 3: ${listed("/sbin/x")}`]],
      [node, "ADD x /etc/ld.so.preload", [`line 3: ${listed("/etc/ld.so.preload")}`]],
      [node, 'COPY ["x", "/bin/x"]', [`line 3: ${listed("/bin/x")}`]],
      [node, "COPY x /app/../usr/bin/x", [`line 3: ${listed("/usr/bin/x")}`]],
      [edge, "COPY x /usr/bin/caddy2", [`line 2: ${listed("/usr/bin/caddy2", "edge")}`]],
      [edge, "COPY x /etc/caddy/../apk/x", [`line 2: ${listed("/etc/apk/x", "edge")}`]],
      [node, "COPY x /usr/bin/caddy", [`line 3: ${listed("/usr/bin/caddy")}`]],
      [node, "COPY x /etc/apt/apt.conf.d/99x", [`line 3: ${listed("/etc/apt/apt.conf.d/99x")}`]],
      [node, "COPY x /etc/dpkg/dpkg.cfg.d/x", [`line 3: ${listed("/etc/dpkg/dpkg.cfg.d/x")}`]],
      [edge, "COPY x /etc/apk/repositories", [`line 2: ${listed("/etc/apk/repositories", "edge")}`]],
      [edge, "COPY x /lib/apk/db/installed", [`line 2: ${listed("/lib/apk/db/installed", "edge")}`]],
      [node, "COPY x /etc/ld.so.conf.d/x.conf", [`line 3: ${listed("/etc/ld.so.conf.d/x.conf")}`]],
      // A maintainer script an allowed purge would run as root.
      [node, "COPY x /var/lib/dpkg/info/x.prerm", [`line 3: ${listed("/var/lib/dpkg/info/x.prerm")}`]],
      // The verifier's x_var_lib_dpkg: the script an allowed purge would then run.
      [
        node,
        "COPY x /var/lib/dpkg/info/apt.prerm\nRUN apt-get purge -y apt",
        [`line 3: ${listed("/var/lib/dpkg/info/apt.prerm")}`],
      ],
      [node, "COPY rootfs/ /", [`line 3: ${plain("/")}`]],
      [node, "COPY etc/ /etc", [`line 3: ${listed("/etc")}`]],
      [node, "COPY usr/ /usr/", [`line 3: ${listed("/usr/")}`]],
      // The verifier's five forms (#532 evidence, cases.md), then relative destinations and other spellings.
      [node, 'COPY x "/usr/bin/x"', [`line 3: ${plain('"/usr/bin/x"')}`]],
      [node, "COPY x '/etc/apt/apt.conf.d/99x'", [`line 3: ${plain("'/etc/apt/apt.conf.d/99x'")}`]],
      [node, `COPY ["x", "'/usr/bin/x'"]`, [`line 3: ${plain("'/usr/bin/x'")}`]],
      [node, "COPY x /usr/b\\in/x", [`line 3: ${plain("/usr/b\\in/x")}`]],
      [node, "WORKDIR /usr/b\\in\nCOPY x x", [`line 3: ${workdir("/usr/b\\in")}`, `line 4: ${plain("x")}`]],
      [node, "WORKDIR /usr/bin\nCOPY x .", [`line 4: ${plain(".")}`]],
      [node, "WORKDIR /usr/bin\nCOPY x x", [`line 4: ${plain("x")}`]],
      [node, "WORKDIR /usr\nWORKDIR bin", [`line 4: ${workdir("bin")}`]],
      [node, 'WORKDIR "/usr/bin"', [`line 3: ${workdir('"/usr/bin"')}`]],
      [node, 'COPY ["x", "/app/\\u0024x"]', [`line 3: ${plain("/app/$x")}`]],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a Dockerfile variable, not a JS template.
      [node, "COPY x ${DEST}", [`line 3: ${plain("${DEST}")}`]],
    ] as const) {
      expect(copyDestinationProblems(`${base}${copy}`), copy).toEqual(problems);
    }
    // Each kind's own entries pass; stages the final one only copies from are not shipped.
    expect(copyDestinationProblems(`${edge}COPY --from=build /out/caddy /usr/bin/caddy`)).toEqual([]);
    expect(copyDestinationProblems(`${edge}COPY snippets/ /etc/caddy/snippets/`)).toEqual([]);
    expect(copyDestinationProblems(`${node}COPY --from=deps /app/shared /app/shared`)).toEqual([]);
    expect(copyDestinationProblems(`FROM ${pinnedNode} AS deps\nCOPY x /usr/bin/x\nFROM ${pinnedNode}`)).toEqual([]);
  });

  test("shipped_copy_chmod_sets_no_special_bit", () => {
    // P1.29p (record 2026-10-08-p129f-corpus-gaps): a shipped COPY's --chmod sets no setuid, setgid or sticky bit, and
    // is plain octal or symbolic. Case x_chmod_setuid first; the built-image test catches what this text rule misses.
    const node = `FROM ${pinnedNode}\n`;
    const special = (mode: string): string => `line 2: --chmod=${mode} sets a setuid, setgid or sticky bit`;
    const unparsed = (mode: string): string => `line 2: --chmod=${mode} is not a plain octal or symbolic mode`;
    for (const [flag, problems] of [
      ["--chmod=4755", [special("4755")]],
      ["--chmod=2755", [special("2755")]],
      ["--chmod=1777", [special("1777")]],
      ["--chmod=u+s", [special("u+s")]],
      ["--chmod=04755", [special("04755")]],
      ["--chmod=g=rxs", [special("g=rxs")]],
      ["--chmod=a+rx,+t", [special("a+rx,+t")]],
      ["--CHMOD=4755", [special("4755")]],
      ["--chown=1:1 --chmod=6755", [special("6755")]],
      ["--chmod=0755 --chmod=4755", [special("4755")]],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a Dockerfile variable, not a JS template.
      ["--chmod=${MODE}", [unparsed("${MODE}")]],
      ["--chmod=", [unparsed("")]],
      ["--chmod=75x", [unparsed("75x")]],
      ["--chmod=99755", [unparsed("99755")]],
      ["--chmod", [unparsed("")]],
      ["--chmod=0755", []],
      ["--chmod=644", []],
      ["--chmod=u=rwx,go=rx", []],
      ["--chmod=a+X", []],
    ] as const) {
      expect(copyDestinationProblems(`${node}COPY ${flag} x /app/x`), flag).toEqual(problems);
    }
    // ADD takes the same flag, and a stage the final stage only copies from is not shipped.
    expect(copyDestinationProblems(`${node}ADD --chmod=4755 x /app/x`)).toEqual([special("4755")]);
    expect(copyDestinationProblems(`FROM ${pinnedNode} AS b\nCOPY --chmod=4755 x /app/x\nFROM ${pinnedNode}`)).toEqual(
      [],
    );
  });

  test("shipped_environment_keys_on_the_kind_list", () => {
    // P1.29f (amendment 7 point 3): a shipped ENV sets only its kind's listed keys, and a shipped stage has no ARG.
    for (const file of dockerfiles) expect(environmentProblems(read(file)), file).toEqual([]);
    const caddy = lock.caddy as Base;
    const edge = `FROM ${caddy.ref}:${caddy.tag}@${caddy.digest}\n`;
    const node = `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n`;
    const listed = (key: string, kind = "node"): string =>
      `line ${kind === "node" ? 3 : 2}: ENV ${key} is not on the ${kind} list`;
    for (const [base, env, problems] of [
      [node, "ENV PATH=/tmp:/usr/local/bin:/usr/bin:/bin", [listed("PATH")]],
      [node, "ENV LD_PRELOAD=/x.so", [listed("LD_PRELOAD")]],
      [node, "ENV LD_LIBRARY_PATH=/x", [listed("LD_LIBRARY_PATH")]],
      [node, "ENV NODE_OPTIONS=--require=/x.js", [listed("NODE_OPTIONS")]],
      [node, "ENV BASH_ENV=/x", [listed("BASH_ENV")]],
      [node, "ENV ENV=/x", [listed("ENV")]],
      [node, "ENV NODE_ENV=production LD_PRELOAD=/x.so", [listed("LD_PRELOAD")]],
      [edge, "ENV NODE_ENV=production", [listed("NODE_ENV", "edge")]],
      [node, "ENV LD_PRELOAD /x.so", ["line 3: cannot parse ENV LD_PRELOAD /x.so"]],
      // The verifier's cases (#532 evidence, cases.md): x_env_ldpreload, x_env_path and x_arg_ldpreload.
      [node, "ENV LD_PRELOAD=/app/x.so\nCOPY --from=deps /app/x.so /app/x.so\nRUN rm -f /x", [listed("LD_PRELOAD")]],
      [node, "ENV PATH=/app/bin:/usr/local/bin:/usr/bin:/bin\nRUN rm -f /x", [listed("PATH")]],
      [node, "ARG X", ["line 3: ARG is not allowed in a shipped stage"]],
      [node, "ARG LD_PRELOAD=/x.so", ["line 3: ARG is not allowed in a shipped stage"]],
    ] as const) {
      expect(environmentProblems(`${base}${env}`), env).toEqual(problems);
    }
    // A stage the final one builds on is shipped; one it only copies from is not.
    expect(environmentProblems(`FROM ${pinnedNode} AS base\nARG X\nFROM base`)).toEqual([
      "line 2: ARG is not allowed in a shipped stage",
    ]);
    expect(environmentProblems(`FROM ${pinnedNode} AS deps\nARG X\nENV LD_PRELOAD=/x\nFROM ${pinnedNode}`)).toEqual([]);
    expect(environmentProblems(`${node}ENV NODE_ENV=production`)).toEqual([]);
  });

  test("heredoc_refused_in_every_stage", () => {
    // P1.29f (amendment 7 point 1): a here-doc body read as instructions could hold a fake final stage, so any `<<`
    // outside a comment fails, in every stage, whatever follows it.
    // The verifier's fake-final-stage Dockerfile (#532 evidence, unset-plan/evidence/p129e-gaps), comments dropped: the
    // here-doc body carries a fake final stage, so the real one's curl install and /usr/local/bin copy went unread.
    const fake = [
      `FROM ${pinnedNode} AS deps`,
      "WORKDIR /app",
      "COPY . .",
      "RUN npm ci --ignore-scripts --omit=dev",
      `FROM ${pinnedNode} AS runtime`,
      "WORKDIR /app",
      "COPY --from=deps /app/package.json package.json",
      "RUN apt-get update && apt-get install -y --no-install-recommends curl",
      "COPY --from=deps /app/package.json /usr/local/bin/evil",
      "RUN rm -f /tmp/x <<\\LABEL",
      `FROM ${pinnedNode} AS runtime2`,
      "LABEL",
      "COPY --from=deps /app/node_modules node_modules",
      "USER 65532:65532",
      'ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]',
    ].join("\n");
    expect(referenceProblems(fake)).toEqual(["line 10: heredoc not supported"]);
    expect(osPackageProblems(fake)).toEqual(["line 10: heredoc not supported"]);
    for (const spelling of ["<<EOF", "<<\\EOF", "<<1", '<<"1x"', "<<-EOF", "<< EOF", "<<'EOF'"]) {
      for (const instruction of [`RUN cat ${spelling}`, `COPY ${spelling} /app/x`]) {
        const build = `FROM ${pinnedNode} AS deps\n${instruction}\nEOF\nFROM ${pinnedNode}`;
        expect(referenceProblems(build), instruction).toEqual(["line 2: heredoc not supported"]);
      }
    }
    expect(referenceProblems(`FROM ${pinnedNode}\n# cat <<EOF\nRUN rm -f /x`)).toEqual([]);
  });

  test("continuation_lines_join_as_buildkit_does", () => {
    // P1.29g (record 2026-10-08-p129f-corpus-gaps, item 5): BuildKit drops only the backslash-newline, so the rules
    // read the text the shell gets. Case g_procsub_cont first.
    const node = `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n`;
    const floor = "a package manager is named outside a removal command";
    expect(osPackageProblems(`${node}RUN rm -f <\\\n(echo x)`)).toEqual([
      "line 3: a process substitution hides what runs",
    ]);
    expect(osPackageProblems(`${node}RUN rm -f >\\\n(cat)`)).toEqual([
      "line 3: a process substitution hides what runs",
    ]);
    expect(osPackageProblems(`${node}RUN ap\\\nk add curl`)).toEqual([
      "line 3: apk add curl: apk may only remove packages",
      `line 3: ${floor}`,
    ]);
    // A here-doc split over a continuation is still one.
    expect(referenceProblems(`${node}RUN cat <\\\n<EOF\nx\nEOF`)).toEqual(["line 3: heredoc not supported"]);
    // A continuation line keeps its leading whitespace, and comment and empty lines inside one are skipped.
    expect(instructions("RUN a \\\n  b\\\n# c\n\nd")).toEqual([{ line: 1, text: "RUN a   bd" }]);
    // A line ending in an escaped backslash is no continuation (BuildKit's `([^\\])\\[ \t]*$`).
    expect(instructions("RUN a\\\\\nRUN b")).toEqual([
      { line: 1, text: "RUN a\\\\" },
      { line: 2, text: "RUN b" },
    ]);
  });

  test("final_stage_globs_on_the_kind_list", () => {
    // P1.29g (record 2026-10-08-p129f-corpus-gaps, item 6): a glob word in a shipped RUN is only one on the kind's
    // list, word for word, in the final stage, so no spelling hides a package manager's name. Case x_glob_rm_dpkg first.
    const node = `FROM ${pinnedNode} AS deps\nFROM ${pinnedNode}\n`;
    const caddy = lock.caddy as Base;
    const edge = `FROM ${caddy.ref}:${caddy.tag}@${caddy.digest}\n`;
    const floor = "a package manager is named outside a removal command";
    const notListed = (shown: string, word: string, kind: string): string =>
      `line ${kind === "node" ? 3 : 2}: ${shown}: ${word} is a glob not on the ${kind} list`;
    for (const word of ["/usr/bin/dp?g", "/usr/bin/ap[t]", "/usr/bin/dpk*"]) {
      expect(osPackageProblems(`${node}RUN rm -rf ${word}`), word).toEqual([notListed(`rm -rf ${word}`, word, "node")]);
    }
    // Brace expansion spells the names out, so the floor sees them too.
    expect(osPackageProblems(`${node}RUN rm -rf /usr/bin/{apt,dpkg}`)).toEqual([
      notListed("rm -rf /usr/bin/{apt,dpkg}", "/usr/bin/{apt,dpkg}", "node"),
      `line 3: ${floor}`,
    ]);
    // Exec form runs no shell, so its words are not globs.
    expect(osPackageProblems(`${node}RUN ["rm", "-f", "/x*"]`)).toEqual([]);
    expect(osPackageProblems(`${node}RUN rm -rf /opt/yarn-*`)).toEqual([]);
    expect(osPackageProblems(`${edge}RUN rm -rf /opt/yarn-*`)).toEqual([
      notListed("rm -rf /opt/yarn-*", "/opt/yarn-*", "edge"),
    ]);
    // A listed glob in a stage the final stage is built FROM is not on the list.
    expect(osPackageProblems(`FROM ${pinnedNode} AS base\nRUN rm -rf /opt/yarn-*\nFROM base`)).toEqual([
      "line 2: rm -rf /opt/yarn-*: /opt/yarn-* is a glob not on the node list",
    ]);
    // P1.29p (record 2026-10-08-p129f-corpus-gaps, amendment 2): a word that holds a listed glob without being it
    // is not on the list.
    for (const word of ["/opt/yarn-*x", "/x/opt/yarn-*", "/opt/yarn-*/x"]) {
      expect(osPackageProblems(`${node}RUN rm -rf ${word}`), word).toEqual([notListed(`rm -rf ${word}`, word, "node")]);
    }
    for (const file of ["images/node-app.Dockerfile", "images/migrate.Dockerfile"]) {
      expect(osPackageProblems(read(file)), file).toEqual([]);
    }
  });

  test("dl3026_ignore_only_on_upstream_base", () => {
    for (const file of dockerfiles) expect(dl3026Problems(read(file), lock), file).toEqual([]);
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
    // The final FROM's ref (docker.io/library/caddy) is shared with a runtime entry, but its digest matches only the
    // build entry, so it fails (amendment 2); the same image listed as both build and runtime may ship.
    expect(finalStageProblems(`FROM ${ship} AS b\nFROM ${build}`, lock)).toEqual([
      `final FROM ${build} is a build base`,
    ]);
    expect(finalStageProblems(`FROM ${build}`, { b: builder, r: { ...builder, stage: "runtime" } })).toEqual([]);
    // Amendment 4: the builder's tag on the runtime digest resolves to no entry, so it cannot pass as the runtime base.
    const crossed = `${runtime.ref}:${builder.tag}@${runtime.digest}`;
    expect(finalStageProblems(`FROM ${build} AS b\nFROM ${crossed}`, lock)).toEqual([
      `final FROM ${crossed} has no lock entry`,
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
    expect(dockerfiles).toEqual(
      expect.arrayContaining(["edge/Dockerfile", "images/migrate.Dockerfile", "images/node-app.Dockerfile"]),
    );
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
    for (const file of dockerfiles) {
      const stage = runtimeStage(read(file));
      expect(
        stage.filter((line) => line.startsWith("USER ")),
        file,
      ).toEqual(["USER 65532:65532"]);
      // Nothing runs as root once the user is set: no RUN follows it.
      expect(
        stage.slice(stage.indexOf("USER 65532:65532")).filter((line) => line.startsWith("RUN ")),
        file,
      ).toEqual([]);
    }
  });

  test("prod_image_has_ssr_build_only", () => {
    expect(dockerfile).toMatch(/^RUN npm run build -w @unset\/apps-web$/m);
    const web = runtime.filter((line) => line.includes("apps/web"));
    expect(web).toEqual([
      "COPY --from=build /app/apps/web/package.json /app/apps/web/package.json",
      "COPY --from=build /app/apps/web/dist /app/apps/web/dist",
    ]);
  });

  test("image_has_no_dev_deps", () => {
    for (const file of nodeDockerfiles) {
      expect(read(file), file).toMatch(/^RUN npm ci --ignore-scripts --omit=dev$/m);
      const copies = runtimeStage(read(file)).filter(
        (line) => line.startsWith("COPY ") && line.includes("node_modules"),
      );
      expect(copies, file).toEqual(["COPY --from=deps /app/node_modules /app/node_modules"]);
    }
  });

  test("runtime_has_no_package_manager", () => {
    for (const file of nodeDockerfiles) {
      const text = read(file);
      const stage = runtimeStage(text);
      const removal = stage.find((line) => line.startsWith("RUN rm -rf ")) ?? "";
      for (const path of [
        "/usr/local/lib/node_modules/npm",
        "/usr/local/lib/node_modules/corepack",
        "/opt/yarn-*",
        ...["npm", "npx", "corepack", "yarn", "yarnpkg", "pnpm", "pnpx"].map((tool) => `/usr/local/bin/${tool}`),
      ]) {
        expect(removal.split(" "), `${file}: ${path}`).toContain(path);
      }
      expect(stage.indexOf(removal), file).toBeLessThan(stage.indexOf("USER 65532:65532"));
      // The earlier stages keep npm: they run npm ci.
      expect(
        text
          .split(/^FROM .*$/m)
          .slice(1, -1)
          .join(""),
        file,
      ).not.toContain("rm -rf");
    }
  });

  test("edge_runtime_has_no_package_manager", () => {
    // The rule runs over every edge-kind image, edge/Dockerfile among them.
    expect(edgeDockerfiles).toEqual(expect.arrayContaining(["edge/Dockerfile"]));
    for (const file of edgeDockerfiles) expect(apkKeptProblems(read(file)), file).toEqual([]);
    const caddy = lock.caddy as Base;
    const edge = `FROM ${caddy.ref}:${caddy.tag}@${caddy.digest}\n`;
    const kept = "the final stage keeps apk: its last apk command does not remove apk-tools";
    for (const run of [
      "RUN apk del --no-network curl libcap",
      "RUN rm -rf /etc/caddy",
      "RUN apk del --no-network apk-tools \\\n  && apk del --no-network curl",
      // P1.29f (fourth architecture note under amendment 7): the last apk command must itself be a removal.
      "RUN apk del --no-network apk-tools && apk add apk-tools",
    ]) {
      expect(apkKeptProblems(`${edge}${run}`), run).toEqual([kept]);
    }
    for (const run of [
      "RUN apk del --no-network curl libcap \\\n  && apk del --no-network apk-tools",
      "RUN apk del --no-network curl libcap apk-tools",
      'RUN ["apk", "del", "--no-network", "apk-tools"]',
    ]) {
      expect(apkKeptProblems(`${edge}${run}`), run).toEqual([]);
    }
  });

  test("runtime_entry_is_the_web_server", () => {
    expect(runtime).toContain('ENTRYPOINT ["node", "interfaces/http/main.ts"]');
    expect(runtime.some((line) => line.startsWith("HEALTHCHECK ") && line.includes("/health"))).toBe(true);
  });
});

// The migrate image (P1.29k): the one-shot `migrate` service, holding the migrator credentials only. Its runtime stage
// copies what `node infrastructure/postgres/migrate-cli.ts` loads and nothing else: no app, entry point, domain, script,
// test or deployment file. migrate.image.test.ts builds it and proves it boots.
describe("migrate image", () => {
  const migrate = runtimeStage(read(MIGRATE_DOCKERFILE));

  test("migrate_image_copies_only_its_paths", () => {
    expect(fromImages(read(MIGRATE_DOCKERFILE))).toEqual([pinnedNode, pinnedNode]);
    expect(migrate.filter((line) => /^(?:COPY|ADD) /.test(line))).toEqual([
      "COPY --from=deps /app/package.json /app/package.json",
      "COPY --from=deps /app/node_modules /app/node_modules",
      "COPY --from=deps /app/shared /app/shared",
      "COPY --from=deps /app/infrastructure/net-guard /app/infrastructure/net-guard",
      "COPY --from=deps /app/infrastructure/postgres /app/infrastructure/postgres",
    ]);
    expect(migrate).toContain('ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]');
    // One-shot: it listens on nothing and Compose waits for its exit, not its health.
    expect(migrate.filter((line) => /^(?:EXPOSE|HEALTHCHECK|CMD) /.test(line))).toEqual([]);
  });
});
