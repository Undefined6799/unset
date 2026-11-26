// A test double for the edge image C18 runs `caddy adapt` in (P1.39c): what a fake `docker` answers, so a preflight
// test needs no Docker. It answers as the real image would for the repository's own edge files: the reviewed adapted
// config of the env whose files are mounted, with the values the call was handed in place of the sentinels. That the
// reviewed configs are what the real image adapts is deployment/edge/adapted.image.test.ts's to prove, in CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SENTINELS } from "../edge/adapted.ts";

type Answer = { code: number; stdout: string; stderr: string };
const ok = (stdout: string): Answer => ({ code: 0, stdout, stderr: "" });

/** The image id the double prints for a build of the edge. */
export const BUILT_EDGE_ID = `sha256:${"0".repeat(64)}`;

/**
 * The env whose reviewed config a run's binds belong to: the dev files, with the chat site's (P6.02) or without, or the
 * local files when one is mounted, else prod.
 */
const envOf = (args: readonly string[]): "dev" | "dev-chat" | "local" | "prod" =>
  args.some((arg) => arg.includes("/edge/dev/chat.caddy"))
    ? "dev-chat"
    : args.some((arg) => arg.includes("/edge/dev/"))
      ? "dev"
      : args.some((arg) => arg.includes("/edge/local/"))
        ? "local"
        : "prod";

/**
 * The answer to one of C18's docker calls (`pull`, `build`, or `run ... caddy adapt`), or null for any other call.
 * `env` is the environment the call added, as the run hands it to the docker client.
 */
export function edgeImageAnswer(args: readonly string[], env: Readonly<Record<string, string>> = {}): Answer | null {
  if (args[0] === "pull") return ok("");
  if (args[0] === "build") return ok(`${BUILT_EDGE_ID}\n`);
  if (args[0] !== "run" || !args.includes("adapt")) return null;
  const reviewed = join(import.meta.dirname, "../edge/adapted", `${envOf(args)}.generated.json`);
  let text = readFileSync(reviewed, "utf8");
  for (const [name, sentinel] of Object.entries(SENTINELS)) {
    const value = env[name];
    if (value !== undefined) text = text.replaceAll(sentinel, JSON.stringify(value).slice(1, -1));
  }
  return ok(text);
}
