// C35 (P2.21a; ADR 0070 point 2.2): the review service, which decodes members' pictures, reaches web and nothing
// else and holds nothing worth stealing.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { c35 } from "./review.ts";
import type { Inputs } from "./types.ts";

const REVIEW = [
  "  review:",
  "    build:",
  "      context: ..",
  "      dockerfile: deployment/images/review.Dockerfile",
  '    user: "65532:65532"',
  "    read_only: true",
  "    cap_drop: [ALL]",
  "    security_opt: [no-new-privileges:true]",
  "    tmpfs:",
  "      - /tmp:uid=65532,gid=65532,mode=1777",
  "    environment:",
  "      UNSET_ENV: dev",
  '      REVIEW_CHILDREN: "2"',
  "    networks: [review_web]",
  "",
].join("\n");
const WEB = "  web:\n    image: w\n    secrets: [s]\n    networks: [review_web, app]\n";
const NETWORKS = "networks:\n  review_web:\n    internal: true\n  app:\n    internal: true\n  out: {}\n";
const SECRETS = "secrets:\n  s:\n    file: ./s\n";

const run = (services: string, networks = NETWORKS) => {
  const compose = parseCompose(
    `name: unset-dev\nservices:\n${services}${networks}${SECRETS}`,
    "/repo/deployment/c.yaml",
  );
  // As loadCompose hands them over: each build resolved against the project directory (inputs.ts).
  for (const service of compose.services)
    if (service.build !== null)
      service.build = { context: "/repo", dockerfile: join("/repo", service.build.dockerfile) };
  return c35.run({ env: "dev", source: true, root: "/repo", compose } as Inputs, AbortSignal.timeout(1000));
};

describe("C35 the review service", () => {
  test("review_on_its_own_network_passes", async () => {
    expect(await run(REVIEW + WEB)).toEqual({ pass: true, reason: "ok" });
    // A stack that runs no review (the image stack, prod today) has nothing to judge.
    expect(await run(WEB)).toEqual({ pass: true, reason: "ok" });
  });

  test("review_on_another_network_fails", async () => {
    const more = REVIEW.replace("networks: [review_web]", "networks: [review_web, out]");
    expect(await run(more + WEB)).toEqual({ pass: false, reason: "review joins a network other than review_web" });
    const none = REVIEW.replace("    networks: [review_web]\n", "    network_mode: host\n");
    expect((await run(none + WEB)).pass).toBe(false);
  });

  test("review_web_holds_only_web_and_review", async () => {
    const third = "  other:\n    image: o\n    networks: [review_web]\n";
    expect(await run(REVIEW + WEB + third)).toEqual({
      pass: false,
      reason: "other is on review_web, which only web and review share",
    });
    const open = NETWORKS.replace("  review_web:\n    internal: true\n", "  review_web: {}\n");
    expect(await run(REVIEW + WEB, open)).toEqual({ pass: false, reason: "review_web is not internal" });
  });

  test("review_with_a_secret_or_a_file_fails", async () => {
    const secret = REVIEW.replace("    networks: [review_web]\n", "    secrets: [s]\n    networks: [review_web]\n");
    expect(await run(secret + WEB)).toEqual({ pass: false, reason: "review reads a secret" });
    const mount = REVIEW.replace(
      "    networks: [review_web]\n",
      "    volumes:\n      - ./x:/x:ro\n    networks: [review_web]\n",
    );
    expect(await run(mount + WEB)).toEqual({ pass: false, reason: "review mounts a file or volume" });
    const envFile = REVIEW.replace(
      "    networks: [review_web]\n",
      "    env_file: ./r.env\n    networks: [review_web]\n",
    );
    expect(await run(envFile + WEB)).toEqual({ pass: false, reason: "review reads an env file" });
  });

  test("review_settings_are_named_literals", async () => {
    const other = REVIEW.replace('      REVIEW_CHILDREN: "2"\n', "      PG_PASSWORD: x\n");
    expect(await run(other + WEB)).toEqual({ pass: false, reason: "review sets a name it does not read" });
    const ref = REVIEW.replace('      REVIEW_CHILDREN: "2"\n', "      REVIEW_CHILDREN: ${CHILDREN}\n");
    expect(await run(ref + WEB)).toEqual({ pass: false, reason: "REVIEW_CHILDREN is not a literal" });
  });

  test("review_runs_hardened", async () => {
    // A root user is refused by the parser itself ("user is not a non-zero UID[:GID] string").
    for (const line of [
      "    read_only: true\n",
      "    cap_drop: [ALL]\n",
      "    security_opt: [no-new-privileges:true]\n",
    ]) {
      expect((await run(REVIEW.replace(line, "") + WEB)).pass, line).toBe(false);
    }
  });

  test("a_service_built_as_review_is_judged_by_its_build", async () => {
    const renamed = REVIEW.replace("  review:\n", "  decoder:\n").replace("[review_web]", "[review_web, out]");
    expect(await run(renamed + WEB)).toEqual({ pass: false, reason: "decoder joins a network other than review_web" });
  });
});
